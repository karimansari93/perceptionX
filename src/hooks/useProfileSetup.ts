import { useQuery } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  GENERAL_KEY,
  LocationEntry,
  buildLocationOptions,
  canonicalizeLocationContext,
  companyCountryKey,
} from '@/utils/locationContext';

// First-login profile setup: the user's name and "what do you want to focus
// on first?" — one subsidiary (company/brand) when the organization has
// several, and one country. The dashboard lands there. Two stores, on
// purpose:
//  - profiles.default_company_id, profiles.default_location_context and
//    profiles.onboarding_completed_at, written through the
//    complete_user_onboarding() / set_dashboard_focus() RPCs. Durable and
//    cross-device; the source of truth. NULL onboarding_completed_at means
//    "still needs setup" (existing users were backfilled as complete by the
//    migration that added the columns).
//  - auth user_metadata copies of the company and location — read
//    synchronously off the session (same trick as full_name), so
//    CompanyContext and the dashboard can apply them on first paint without
//    a profile round-trip.
// The star (useStarredView) still wins when the user has pinned a view in
// this browser; the profile focus is the fallback beneath it.

export const DEFAULT_LOCATION_METADATA_KEY = 'default_location_context';
export const DEFAULT_COMPANY_ID_METADATA_KEY = 'default_company_id';
export const DEFAULT_COMPANY_NAME_METADATA_KEY = 'default_company_name';

export interface ProfileSetupStatus {
  fullName: string | null;
  // Raw location_context spelling, as stored.
  defaultLocationContext: string | null;
  defaultCompanyId: string | null;
  onboardingCompletedAt: string | null;
}

// One subsidiary in the user's organization: same-name company rows (one
// per country) grouped together, the way the dashboard's company switcher
// does.
export interface BrandCompany {
  id: string;
  name: string;
  country: string | null;
}

export interface OrgBrand {
  key: string; // lower-cased name
  name: string;
  companies: BrandCompany[];
}

export interface DefaultCompanyRef {
  id: string;
  name: string;
}

type ProfileSetupRow = {
  full_name?: string | null;
  default_location_context?: string | null;
  default_company_id?: string | null;
  onboarding_completed_at?: string | null;
};

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
        .select('full_name, default_location_context, default_company_id, onboarding_completed_at')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      // A missing row (a pre-rollback partial invite) reads as "needs setup";
      // the RPC creates the row when the user completes it.
      const row = (data ?? null) as unknown as ProfileSetupRow | null;
      return {
        fullName: row?.full_name ?? null,
        defaultLocationContext: row?.default_location_context ?? null,
        defaultCompanyId: row?.default_company_id ?? null,
        onboardingCompletedAt: row?.onboarding_completed_at ?? null,
      };
    },
  });
}

// The organization the pickers draw from: the user's default membership,
// else the earliest one.
async function resolveSetupOrgId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id, is_default, joined_at')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('joined_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data as unknown as Array<{ organization_id: string }> | null)?.[0]?.organization_id ?? null;
}

// Subsidiaries in the user's organization (companies grouped by name),
// biggest footprint first so the org's main brand is the natural default.
export function useOrgBrands(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['profile-setup', 'org-brands', userId ?? 'anon'],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ orgId: string | null; brands: OrgBrand[] }> => {
      const orgId = await resolveSetupOrgId(userId as string);
      if (!orgId) return { orgId: null, brands: [] };
      const { data, error } = await supabase
        .from('organization_companies')
        .select('companies(id, name, country)')
        .eq('organization_id', orgId);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as Array<{ companies: BrandCompany | BrandCompany[] | null }>)
        .flatMap((r) => (Array.isArray(r.companies) ? r.companies : r.companies ? [r.companies] : []));
      const byKey = new Map<string, OrgBrand>();
      for (const c of rows) {
        if (!c?.id || !c.name) continue;
        const name = c.name.trim();
        const key = name.toLowerCase();
        const brand = byKey.get(key) ?? { key, name, companies: [] };
        brand.companies.push({ id: c.id, name, country: c.country ?? null });
        byKey.set(key, brand);
      }
      const brands = Array.from(byKey.values()).sort(
        (a, b) => b.companies.length - a.companies.length || a.name.localeCompare(b.name),
      );
      return { orgId, brands };
    },
  });
}

// Country choices for the picker: every location bucket with data or
// configured prompts across the given subsidiary's company rows (or the
// whole organization when `brand` is null), plus each row's own country,
// rendered through the same option builder as the dashboard filter so "the
// United Kingdom" and "United Kingdom" collapse to one entry with the same
// canonical key the dashboard uses. `brand === undefined` means "not decided
// yet" and leaves the query pending.
export function useOrgLocationOptions(
  userId: string | null | undefined,
  brand: OrgBrand | null | undefined,
) {
  const companyIds = brand ? brand.companies.map((c) => c.id) : null;
  return useQuery({
    queryKey: [
      'profile-setup',
      'org-locations',
      userId ?? 'anon',
      companyIds ? [...companyIds].sort().join(',') : 'org',
    ],
    enabled: !!userId && brand !== undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<LocationEntry[]> => {
      const orgId = await resolveSetupOrgId(userId as string);
      if (!orgId) return [];
      const { data, error } = await supabase.rpc(
        'list_org_location_buckets' as never,
        { p_org_id: orgId, p_company_ids: companyIds } as never,
      );
      if (error) throw error;
      const buckets = Array.isArray(data)
        ? (data as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      return buildLocationOptions([], brand?.companies ?? [], [], buckets).options.filter(
        (o) => o.canonicalKey !== GENERAL_KEY,
      );
    },
  });
}

export const brandForCompanyId = (
  brands: OrgBrand[],
  companyId: string | null | undefined,
): OrgBrand | null =>
  companyId ? brands.find((b) => b.companies.some((c) => c.id === companyId)) ?? null : null;

// The company row stored for a subsidiary: the one whose country matches the
// chosen location, else the brand's first row. The dashboard's brand scope
// merges the siblings anyway; this just picks where to land.
export const representativeCompanyId = (
  brand: OrgBrand | null | undefined,
  locationKey: string | null,
): string | null => {
  if (!brand || brand.companies.length === 0) return null;
  const byLocation = locationKey
    ? brand.companies.find((c) => companyCountryKey(c.country) === locationKey)
    : undefined;
  return (byLocation ?? brand.companies[0]).id;
};

// A canonical key is only valid if the subsidiary offers it; anything else
// falls back to "All countries".
export const validLocationKey = (
  locationKey: string | null,
  options: LocationEntry[],
): string | null =>
  locationKey && options.some((o) => o.canonicalKey === locationKey) ? locationKey : null;

// Canonical key → the raw spelling the DB stores (the first raw value of the
// matching option — what reports and the MCP tools speak).
export const locationRawValue = (
  locationKey: string | null,
  options: LocationEntry[],
): string | null => {
  if (!locationKey) return null;
  const entry = options.find((o) => o.canonicalKey === locationKey);
  return entry ? entry.rawValues[0] ?? entry.label : locationKey;
};

// Metadata fragment to merge into supabase.auth.updateUser({ data }) so the
// session carries the choice. Callers that also set a password or full_name
// spread this into the same call — one auth round-trip.
export const profileSetupMetadata = (
  locationKey: string | null,
  options: LocationEntry[],
  brand: OrgBrand | null | undefined,
): Record<string, unknown> => ({
  [DEFAULT_LOCATION_METADATA_KEY]: locationRawValue(locationKey, options),
  [DEFAULT_COMPANY_ID_METADATA_KEY]: representativeCompanyId(brand, locationKey),
  [DEFAULT_COMPANY_NAME_METADATA_KEY]: brand?.name ?? null,
});

// Persists the answers to profiles (name, company, location, completion
// stamp) in one RLS-safe call. Throws on failure so callers can keep the
// user on the form instead of sending them to a dashboard that gates again.
export async function completeProfileSetup(args: {
  fullName: string;
  locationKey: string | null;
  options: LocationEntry[];
  brand: OrgBrand | null | undefined;
}): Promise<void> {
  const { error } = await supabase.rpc(
    'complete_user_onboarding' as never,
    {
      p_full_name: args.fullName,
      p_default_location_context: locationRawValue(args.locationKey, args.options),
      p_default_company_id: representativeCompanyId(args.brand, args.locationKey),
    } as never,
  );
  if (error) throw error;
}

// Account page: change the focus later without touching the name.
export async function saveDashboardFocus(args: {
  locationKey: string | null;
  options: LocationEntry[];
  brand: OrgBrand | null | undefined;
}): Promise<void> {
  const { error } = await supabase.rpc(
    'set_dashboard_focus' as never,
    {
      p_default_location_context: locationRawValue(args.locationKey, args.options),
      p_default_company_id: representativeCompanyId(args.brand, args.locationKey),
    } as never,
  );
  if (error) throw error;
}

// Canonical key the dashboard should open on for this user; null = "All
// countries" / no preference.
export const defaultLocationFromUser = (user: User | null | undefined): string | null => {
  const raw = user?.user_metadata?.[DEFAULT_LOCATION_METADATA_KEY];
  return typeof raw === 'string' ? canonicalizeLocationContext(raw) : null;
};

// The company the dashboard should land on for this user, from the session
// copy; null = no preference (the app's usual first-brand heuristic).
export const defaultCompanyFromUser = (user: User | null | undefined): DefaultCompanyRef | null => {
  const id = user?.user_metadata?.[DEFAULT_COMPANY_ID_METADATA_KEY];
  const name = user?.user_metadata?.[DEFAULT_COMPANY_NAME_METADATA_KEY];
  return typeof id === 'string' && id ? { id, name: typeof name === 'string' ? name : '' } : null;
};

// Whether the profile's location preference applies while `company` is the
// active company: it was chosen for one subsidiary, so any other opens on
// "All locations" (mirrors how a starred view is bound to its company).
export const focusAppliesToCompany = (
  user: User | null | undefined,
  company: { id: string; name: string } | null | undefined,
): boolean => {
  const preferred = defaultCompanyFromUser(user);
  if (!preferred) return true;
  if (!company) return false;
  if (company.id === preferred.id) return true;
  return (
    preferred.name !== '' &&
    company.name.trim().toLowerCase() === preferred.name.trim().toLowerCase()
  );
};
