import { useQuery } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  GENERAL_KEY,
  LocationEntry,
  buildLocationOptions,
  canonicalizeLocationContext,
} from '@/utils/locationContext';

// First-login profile setup: the user's name plus the location they care
// about most, so the dashboard opens on it. Two stores, on purpose:
//  - profiles.default_location_context + profiles.onboarding_completed_at,
//    written through the complete_user_onboarding() RPC. Durable and
//    cross-device; the source of truth. NULL onboarding_completed_at means
//    "still needs setup" (existing users were backfilled as complete by the
//    migration that added the columns).
//  - auth user_metadata.default_location_context — a copy the client reads
//    synchronously off the session (same trick as full_name), so the dashboard
//    can apply the default on first paint without a profile round-trip.
// The star (useStarredView) still wins when the user has pinned a view in
// this browser; the profile default is the fallback beneath it.

export const DEFAULT_LOCATION_METADATA_KEY = 'default_location_context';

export interface ProfileSetupStatus {
  fullName: string | null;
  defaultLocationContext: string | null;
  onboardingCompletedAt: string | null;
}

type ProfileSetupRow = {
  full_name?: string | null;
  default_location_context?: string | null;
  onboarding_completed_at?: string | null;
};

export const profileSetupQueryKey = (userId: string | null | undefined) =>
  ['profile-setup', 'status', userId ?? 'anon'] as const;

// The signed-in user's setup state. Cached for the session — it only changes
// through completeProfileSetup() / the Account page, which update the cache.
export function useProfileSetupStatus(userId: string | null | undefined) {
  return useQuery({
    queryKey: profileSetupQueryKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<ProfileSetupStatus> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, default_location_context, onboarding_completed_at')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      // A missing row (a pre-rollback partial invite) reads as "needs setup";
      // the RPC creates the row when the user completes it.
      const row = (data ?? null) as unknown as ProfileSetupRow | null;
      return {
        fullName: row?.full_name ?? null,
        defaultLocationContext: row?.default_location_context ?? null,
        onboardingCompletedAt: row?.onboarding_completed_at ?? null,
      };
    },
  });
}

// Location choices for the setup picker: every location bucket with data or
// configured prompts across the user's organization (the default membership,
// else the first). Rendered through the same option builder as the dashboard
// filter, so "the United Kingdom" and "United Kingdom" collapse to one entry
// with the same canonical key the dashboard uses.
export function useOrgLocationOptions(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['profile-setup', 'org-locations', userId ?? 'anon'],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LocationEntry[]> => {
      const { data: memberships, error: membershipError } = await supabase
        .from('organization_members')
        .select('organization_id, is_default, joined_at')
        .eq('user_id', userId as string)
        .order('is_default', { ascending: false })
        .order('joined_at', { ascending: true })
        .limit(1);
      if (membershipError) throw membershipError;
      const orgId = (memberships as unknown as Array<{ organization_id: string }> | null)?.[0]
        ?.organization_id;
      if (!orgId) return [];

      const { data, error } = await supabase.rpc(
        'list_org_location_buckets' as never,
        { p_org_id: orgId } as never,
      );
      if (error) throw error;
      const buckets = Array.isArray(data)
        ? (data as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      return buildLocationOptions([], [], [], buckets).options.filter(
        (o) => o.canonicalKey !== GENERAL_KEY,
      );
    },
  });
}

// The stored value is the raw location_context spelling (what the DB, reports
// and the MCP tools speak); the dashboard canonicalizes it on read.
export const locationEntryRawValue = (entry: LocationEntry | null): string | null =>
  entry?.rawValues[0] ?? entry?.label ?? null;

// Metadata fragment to merge into supabase.auth.updateUser({ data }) so the
// session carries the choice. Callers that also set a password or full_name
// spread this into the same call — one auth round-trip.
export const profileSetupMetadata = (entry: LocationEntry | null): Record<string, string | null> => ({
  [DEFAULT_LOCATION_METADATA_KEY]: locationEntryRawValue(entry),
});

// Persists the answers to profiles (name, default location, completion stamp)
// in one RLS-safe call. Throws on failure so callers can keep the user on the
// form instead of sending them to a dashboard that will gate them again.
export async function completeProfileSetup(args: {
  fullName: string;
  location: LocationEntry | null;
}): Promise<void> {
  const { error } = await supabase.rpc(
    'complete_user_onboarding' as never,
    {
      p_full_name: args.fullName,
      p_default_location_context: locationEntryRawValue(args.location),
    } as never,
  );
  if (error) throw error;
}

// Canonical location key the dashboard should open on for this user, from the
// session copy of their default; null = "All locations" / no preference.
export const defaultLocationFromUser = (user: User | null | undefined): string | null => {
  const raw = user?.user_metadata?.[DEFAULT_LOCATION_METADATA_KEY];
  return typeof raw === 'string' ? canonicalizeLocationContext(raw) : null;
};
