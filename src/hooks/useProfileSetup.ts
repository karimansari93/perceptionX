import { useQuery } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  GENERAL_KEY,
  LocationEntry,
  buildLocationOptions,
  canonicalizeLocationContext,
} from '@/utils/locationContext';

// First-login profile setup: the user's name plus the locations they focus
// on, one of which is the PRIORITY the dashboard opens on; the rest are
// pinned at the top of the dashboard's location menu. Two stores, on purpose:
//  - profiles.default_location_context (priority), profiles.focus_location_contexts
//    (ordered list) and profiles.onboarding_completed_at, written through the
//    complete_user_onboarding() / set_focus_locations() RPCs. Durable and
//    cross-device; the source of truth. NULL onboarding_completed_at means
//    "still needs setup" (existing users were backfilled as complete by the
//    migration that added the columns).
//  - auth user_metadata copies of the priority and the list — read
//    synchronously off the session (same trick as full_name), so the
//    dashboard can apply them on first paint without a profile round-trip.
// The star (useStarredView) still wins when the user has pinned a view in
// this browser; the profile priority is the fallback beneath it.

export const DEFAULT_LOCATION_METADATA_KEY = 'default_location_context';
export const FOCUS_LOCATIONS_METADATA_KEY = 'focus_location_contexts';

export interface ProfileSetupStatus {
  fullName: string | null;
  // Raw location_context spellings, as stored.
  defaultLocationContext: string | null;
  focusLocationContexts: string[];
  onboardingCompletedAt: string | null;
}

// The user's picks in dashboard terms (canonical location keys).
export interface FocusSelection {
  keys: string[]; // ordered, deduped
  primary: string | null; // one of `keys`, or null = "All locations"
}

export const EMPTY_FOCUS: FocusSelection = { keys: [], primary: null };

type ProfileSetupRow = {
  full_name?: string | null;
  default_location_context?: string | null;
  focus_location_contexts?: unknown;
  onboarding_completed_at?: string | null;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const profileSetupQueryKey = (userId: string | null | undefined) =>
  ['profile-setup', 'status', userId ?? 'anon'] as const;

// The signed-in user's setup state. Cached for the session — it only changes
// through the save helpers below, which update the cache themselves.
export function useProfileSetupStatus(userId: string | null | undefined) {
  return useQuery({
    queryKey: profileSetupQueryKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<ProfileSetupStatus> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, default_location_context, focus_location_contexts, onboarding_completed_at')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      // A missing row (a pre-rollback partial invite) reads as "needs setup";
      // the RPC creates the row when the user completes it.
      const row = (data ?? null) as unknown as ProfileSetupRow | null;
      return {
        fullName: row?.full_name ?? null,
        defaultLocationContext: row?.default_location_context ?? null,
        focusLocationContexts: toStringArray(row?.focus_location_contexts),
        onboardingCompletedAt: row?.onboarding_completed_at ?? null,
      };
    },
  });
}

// Location choices for the picker: every location bucket with data or
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

// Stored raw spellings → canonical keys. Guarantees the invariants the picker
// relies on: no duplicates, the priority is in the list, and a non-empty list
// always has a priority.
export const focusSelectionFromRaw = (
  primaryRaw: string | null | undefined,
  focusRaw: readonly string[] | null | undefined,
): FocusSelection => {
  const keys: string[] = [];
  for (const raw of focusRaw ?? []) {
    const key = canonicalizeLocationContext(raw);
    if (key && !keys.includes(key)) keys.push(key);
  }
  let primary = canonicalizeLocationContext(primaryRaw);
  if (primary && !keys.includes(primary)) keys.unshift(primary);
  if (!primary && keys.length > 0) primary = keys[0];
  return { keys, primary };
};

// Drop keys the organization no longer offers (the picker can't show them),
// re-pointing the priority if it was one of them.
export const pruneFocusSelection = (
  selection: FocusSelection,
  options: LocationEntry[],
): FocusSelection => {
  const keys = selection.keys.filter((k) => options.some((o) => o.canonicalKey === k));
  const primary =
    selection.primary && keys.includes(selection.primary) ? selection.primary : keys[0] ?? null;
  return { keys, primary };
};

// Canonical keys → the raw spelling the DB stores (the first raw value of the
// matching option — what reports and the MCP tools speak). A key with no
// option is stored as-is; it still canonicalizes on read.
const rawValueForKey = (key: string, options: LocationEntry[]): string => {
  const entry = options.find((o) => o.canonicalKey === key);
  return entry ? entry.rawValues[0] ?? entry.label : key;
};

export const focusSelectionToRaw = (
  selection: FocusSelection,
  options: LocationEntry[],
): { primary: string | null; focus: string[] } => ({
  primary: selection.primary ? rawValueForKey(selection.primary, options) : null,
  focus: selection.keys.map((k) => rawValueForKey(k, options)),
});

// Metadata fragment to merge into supabase.auth.updateUser({ data }) so the
// session carries the choice. Callers that also set a password or full_name
// spread this into the same call — one auth round-trip.
export const profileSetupMetadata = (
  selection: FocusSelection,
  options: LocationEntry[],
): Record<string, unknown> => {
  const raw = focusSelectionToRaw(selection, options);
  return {
    [DEFAULT_LOCATION_METADATA_KEY]: raw.primary,
    [FOCUS_LOCATIONS_METADATA_KEY]: raw.focus,
  };
};

// Persists the answers to profiles (name, locations, completion stamp) in one
// RLS-safe call. Throws on failure so callers can keep the user on the form
// instead of sending them to a dashboard that will gate them again.
export async function completeProfileSetup(args: {
  fullName: string;
  selection: FocusSelection;
  options: LocationEntry[];
}): Promise<void> {
  const raw = focusSelectionToRaw(args.selection, args.options);
  const { error } = await supabase.rpc(
    'complete_user_onboarding' as never,
    {
      p_full_name: args.fullName,
      p_default_location_context: raw.primary,
      p_focus_location_contexts: raw.focus,
    } as never,
  );
  if (error) throw error;
}

// Account page: change the locations later without touching the name.
export async function saveFocusLocations(args: {
  selection: FocusSelection;
  options: LocationEntry[];
}): Promise<void> {
  const raw = focusSelectionToRaw(args.selection, args.options);
  const { error } = await supabase.rpc(
    'set_focus_locations' as never,
    {
      p_default_location_context: raw.primary,
      p_focus_location_contexts: raw.focus,
    } as never,
  );
  if (error) throw error;
}

// The user's picks from the session copy, in canonical keys.
export const focusSelectionFromUser = (user: User | null | undefined): FocusSelection => {
  const primary = user?.user_metadata?.[DEFAULT_LOCATION_METADATA_KEY];
  return focusSelectionFromRaw(
    typeof primary === 'string' ? primary : null,
    toStringArray(user?.user_metadata?.[FOCUS_LOCATIONS_METADATA_KEY]),
  );
};

// Canonical key the dashboard should open on for this user; null = "All
// locations" / no preference.
export const defaultLocationFromUser = (user: User | null | undefined): string | null =>
  focusSelectionFromUser(user).primary;

// Canonical keys to pin at the top of the dashboard's location menu.
export const focusLocationsFromUser = (user: User | null | undefined): string[] =>
  focusSelectionFromUser(user).keys;
