import { describe, expect, it } from 'vitest';
import {
  GENERAL_KEY,
  buildLocationOptions,
  canonicalizeLocationContext,
  labelForCanonicalKey,
  makeLocationMatcher,
} from './locationContext';
import { selectScopeRows } from '@/hooks/dashboard/scopeStatsSelect';

// A brand tracked across two Latin American markets (one legacy per-country
// profile, one tagged through location_context), India, and a city.
const FBS_BR = 'c-br';
const FBS_IN = 'c-in';
const scope = [
  { id: FBS_BR, country: 'BR' },
  { id: FBS_IN, country: null },
];
const responses = [
  { company_id: FBS_BR, confirmed_prompts: { location_context: null } },
  { company_id: FBS_IN, confirmed_prompts: { location_context: 'India' } },
  { company_id: FBS_IN, confirmed_prompts: { location_context: 'Mexico' } },
  { company_id: FBS_IN, confirmed_prompts: { location_context: 'the Netherlands' } },
  { company_id: FBS_IN, confirmed_prompts: { location_context: 'Burbank' } },
];

describe('region entries in the location options', () => {
  const { options, rawValuesByKey } = buildLocationOptions(responses, scope);
  const latam = options.find((o) => o.canonicalKey === 'region:latin-america');

  it('adds a region only when at least two of its countries are tracked', () => {
    expect(latam).toBeDefined();
    // India is Asia Pacific's only tracked market; the Netherlands is
    // Europe's only one: neither region is offered.
    expect(options.some((o) => o.canonicalKey === 'region:asia-pacific')).toBe(false);
    expect(options.some((o) => o.canonicalKey === 'region:europe')).toBe(false);
  });

  it('unions its member countries and lists regions first', () => {
    expect(latam!.label).toBe('Latin America');
    expect(latam!.icon).toBe('region');
    expect(latam!.memberKeys).toEqual(['brazil', 'mexico']);
    // Brazil is a legacy per-country profile: untagged data is owned via
    // companyIds; Mexico arrives as a tagged spelling.
    expect(latam!.companyIds).toEqual([FBS_BR]);
    expect(latam!.rawValues).toEqual(['Mexico']);
    expect(rawValuesByKey['region:latin-america']).toEqual(['Mexico']);
    expect(options[0].canonicalKey).toBe('region:latin-america');
    // Cities never join a region.
    expect(options.find((o) => o.canonicalKey === 'burbank')!.flagCode).toBeNull();
  });

  it('round-trips a region key through canonicalization and labelling', () => {
    expect(canonicalizeLocationContext('region:latin-america')).toBe('region:latin-america');
    expect(canonicalizeLocationContext(' Region:Latin-America ')).toBe('region:latin-america');
    expect(labelForCanonicalKey('region:latin-america')).toBe('Latin America');
    expect(labelForCanonicalKey('united states')).toBe('United States');
  });
});

describe('makeLocationMatcher', () => {
  const entry = { memberKeys: ['brazil', 'mexico'] };

  it('matches any member country for a region, nothing else', () => {
    const m = makeLocationMatcher('region:latin-america', entry);
    expect(m('brazil')).toBe(true);
    expect(m('mexico')).toBe(true);
    expect(m('india')).toBe(false);
    expect(m(null)).toBe(false);
  });

  it('keeps the exact-key and General rules unchanged', () => {
    expect(makeLocationMatcher('india', null)('india')).toBe(true);
    expect(makeLocationMatcher('india', null)('brazil')).toBe(false);
    expect(makeLocationMatcher(GENERAL_KEY, null)(null)).toBe(true);
    expect(makeLocationMatcher(GENERAL_KEY, null)('india')).toBe(false);
    expect(makeLocationMatcher(null, null)('anything')).toBe(true);
  });

  it('matches nothing for a region whose entry is unresolved', () => {
    expect(makeLocationMatcher('region:latin-america', null)('brazil')).toBe(false);
  });
});

describe('scope-stats cube selection by region', () => {
  const countryKeyByCompanyId = new Map<string, string | null>([[FBS_BR, 'brazil'], [FBS_IN, null]]);
  const rows = [
    { company_id: FBS_BR, location_context: '', response_month: '2026-07-01' },
    { company_id: FBS_IN, location_context: 'Mexico', response_month: '2026-07-01' },
    { company_id: FBS_IN, location_context: 'India', response_month: '2026-07-01' },
  ] as unknown as Parameters<typeof selectScopeRows>[0];

  it('pools the member countries of the region', () => {
    const picked = selectScopeRows(rows, {
      locationKey: 'region:latin-america',
      locationMemberKeys: ['brazil', 'mexico'],
      countryKeyByCompanyId,
      quarterKey: null,
    });
    expect(picked.map((r) => r.location_context)).toEqual(['', 'Mexico']);
  });
});
