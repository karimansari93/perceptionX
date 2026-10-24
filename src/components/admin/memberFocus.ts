// Pure helpers for the admin "quarterly email" controls on an organization's
// members. A member's email scope IS their dashboard focus: the brand
// (profiles.default_company_id, one row of the subsidiary) and the location
// selection (profiles.default_location_context — one market, a region key
// or a set key, see utils/locationSelection.ts).

import { canonicalizeLocationContext, labelForCanonicalKey } from '@/utils/locationContext';
import type { OrgBrand } from '@/hooks/useProfileSetup';

export interface MemberFocus {
  defaultCompanyId: string | null;
  defaultLocationContext: string | null;
}

// The subsidiary a stored company row belongs to, if the org still has it.
export const brandForCompany = (brands: OrgBrand[], companyId: string | null | undefined): OrgBrand | null =>
  companyId ? brands.find((b) => b.companies.some((c) => c.id === companyId)) ?? null : null;

// One line for the members table: "Ford Business Solutions · Latin America",
// "Ford · India, United States", "All brands · All locations".
export const describeMemberFocus = (focus: MemberFocus, brands: OrgBrand[]): string => {
  const brand = brandForCompany(brands, focus.defaultCompanyId);
  const locationKey = canonicalizeLocationContext(focus.defaultLocationContext);
  const brandLabel = brand ? brand.name : 'All brands';
  const locationLabel = locationKey ? labelForCanonicalKey(locationKey) : 'All locations';
  return `${brandLabel} · ${locationLabel}`;
};
