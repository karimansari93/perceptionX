// Helpers for the flexible Location filter.
//
// Historically "location" meant a country: the dashboard switched between
// company rows that each carried a `country` (Netflix-US ↔ Netflix-Japan). But
// the real, free-form location lives on `confirmed_prompts.location_context`,
// which can be a country ("United States"), an article-prefixed country
// ("the Netherlands"), a state ("California"), a city ("Burbank", "Sydney",
// "Vancouver"), or a global sentinel. This module canonicalizes those raw
// strings, resolves a display label + icon for any granularity, and builds the
// merged dropdown option list (in-company location filters + legacy
// cross-country company switches).

import { COUNTRY_NAMES } from '@/lib/marketName';
import { getCountryFlag } from '@/utils/countryFlags';
import { GLOBAL_LIKE } from '@/utils/locations';

export type LocationIconKind = 'flag' | 'pin' | 'globe';

// Reserved canonical key for the "General" entry: prompts run with NO location
// (legacy prompts, before we started tagging every prompt with a location).
// Distinct from `null` selectedLocation, which means "All locations" (every
// prompt, general + located). Only surfaces for companies that actually have
// general prompts — new companies (e.g. Netflix Animation Studios) have none.
export const GENERAL_KEY = '__general__';

// A single dropdown row. `canonicalKey` is the stable identity used as the
// active-filter value; `rawValues` are the exact stored `location_context`
// strings that collapse to this entry (so filtering matches "the United
// States" AND "United States"). `action` decides what clicking does.
export interface LocationEntry {
  canonicalKey: string;
  label: string;
  icon: LocationIconKind;
  flagCode: string | null; // ISO code when resolvable, for flag rendering
  rawValues: string[];
  action: { type: 'filter' } | { type: 'switchCompany'; companyId: string };
}

// Reverse lookup: lowercased country name → ISO code (e.g. "united states" → "US").
const NAME_TO_CODE: Record<string, string> = Object.entries(COUNTRY_NAMES).reduce(
  (acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    return acc;
  },
  {} as Record<string, string>
);

const stripLeadingThe = (value: string): string =>
  value.replace(/^the\s+/i, '').trim();

// Treat a 2-letter token that maps to a known country as an ISO code (e.g.
// "US", "DE"). Longer strings ("Burbank") are taken literally.
const isoCodeFor = (value: string): string | null => {
  const upper = value.toUpperCase();
  if (upper.length === 2 && COUNTRY_NAMES[upper]) return upper;
  return null;
};

// Resolve an ISO code for any raw location string, whether it arrives as a code
// ("US") or a full country name ("United States"). Returns null for
// cities/states/continents that aren't countries.
const codeForLocation = (stripped: string): string | null => {
  const code = isoCodeFor(stripped);
  if (code) return code;
  return NAME_TO_CODE[stripped.toLowerCase()] ?? null;
};

// Canonical key for a raw `location_context`. Returns null for global/empty
// sentinels (which mean "no location filter"). ISO codes and full country names
// for the same place collapse to one key; a leading "the " is dropped.
export const canonicalizeLocationContext = (
  raw: string | null | undefined
): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || GLOBAL_LIKE.has(trimmed)) return null;

  const stripped = stripLeadingThe(trimmed);
  if (!stripped || GLOBAL_LIKE.has(stripped)) return null;

  const code = codeForLocation(stripped);
  if (code) return COUNTRY_NAMES[code].toLowerCase();
  return stripped.toLowerCase();
};

// Human-friendly label for a single raw value: country names render fully
// ("US" → "United States"); everything else passes through with "the " removed.
const displayFromRaw = (raw: string): string => {
  const stripped = stripLeadingThe(raw.trim());
  const code = codeForLocation(stripped);
  if (code) return COUNTRY_NAMES[code];
  return stripped;
};

export const locationFlag = (raw: string): string => {
  const code = codeForLocation(stripLeadingThe(raw.trim()));
  return code ? getCountryFlag(code) : '';
};

export const locationIconKind = (raw: string): LocationIconKind => {
  const canonical = canonicalizeLocationContext(raw);
  if (canonical === null) return 'globe';
  return locationFlag(raw) ? 'flag' : 'pin';
};

// Title-case fallback label for a canonical key with no matching entry (e.g. a
// starred location for a company that no longer has it).
export const labelForCanonicalKey = (key: string): string =>
  key.replace(/\b\w/g, (c) => c.toUpperCase());

type ResponseLike = { confirmed_prompts?: { location_context?: string | null } | null };
type SiblingCompanyLike = { id: string; country?: string | null };

// Build the merged dropdown options for the current company:
//  - one `filter` entry per distinct in-company `location_context`, and
//  - one `switchCompany` entry per same-name sibling company in a country that
//    isn't already represented in the current company's data (legacy behavior).
// Also returns the canonicalKey → rawValues map so the response filter can match
// every stored spelling of a location.
//
// `extraBucketValues` are distinct location_context buckets from the
// `_by_location_mv` views (all-time), used EXTEND-ONLY: they widen the
// rawValues of entries that already exist in the loaded responses, so the MV
// queries match historical spellings that fell out of the eager response
// window (e.g. "the United States" only present in old months). They never
// create new dropdown entries — a location with zero loaded responses would
// otherwise render an empty prompts/visibility view.
export const buildLocationOptions = (
  responses: ResponseLike[],
  siblingCompanies: SiblingCompanyLike[] = [],
  extraBucketValues: string[] = []
): { options: LocationEntry[]; rawValuesByKey: Record<string, string[]> } => {
  type Builder = {
    canonicalKey: string;
    rawValues: Set<string>;
    action: LocationEntry['action'];
  };
  const builders = new Map<string, Builder>();
  // MV bucket keys for general/no-location prompts present in this company's
  // data. The by-location MVs key null/empty location_context as '' and keep
  // 'GLOBAL'/'Global (All Countries)' as-is, so we collect the matching bucket
  // key per general response to drive both the response filter and MV query.
  const generalBuckets = new Set<string>();

  // In-company locations → response filters.
  for (const r of responses) {
    const raw = r.confirmed_prompts?.location_context;
    const key = canonicalizeLocationContext(raw);
    if (key === null) {
      // General / no-location prompt (null, '', or a GLOBAL_LIKE sentinel).
      generalBuckets.add(raw == null || raw.trim() === '' ? '' : raw.trim());
      continue;
    }
    const existing = builders.get(key);
    if (existing) {
      existing.rawValues.add(raw!.trim());
    } else {
      builders.set(key, {
        canonicalKey: key,
        rawValues: new Set([raw!.trim()]),
        action: { type: 'filter' },
      });
    }
  }

  // Sibling companies in other countries → company switches. Skip any location
  // the current company already covers in its own data (the filter entry wins).
  for (const c of siblingCompanies) {
    const key = canonicalizeLocationContext(c.country);
    if (key === null || !c.country) continue;
    if (builders.has(key)) continue;
    builders.set(key, {
      canonicalKey: key,
      rawValues: new Set([c.country.trim()]),
      action: { type: 'switchCompany', companyId: c.id },
    });
  }

  // Widen existing entries with MV bucket spellings (extend-only; see above).
  // The MVs bucket null/empty location_context as '' and keep GLOBAL-like
  // sentinels verbatim, so canonicalize-to-null buckets extend "General".
  for (const bucket of extraBucketValues) {
    const key = canonicalizeLocationContext(bucket);
    if (key === null) {
      if (generalBuckets.size > 0) {
        generalBuckets.add(bucket.trim() === '' ? '' : bucket.trim());
      }
      continue;
    }
    const existing = builders.get(key);
    if (existing && existing.action.type === 'filter') {
      existing.rawValues.add(bucket.trim());
    }
  }

  const rawValuesByKey: Record<string, string[]> = {};
  const options: LocationEntry[] = Array.from(builders.values()).map((b) => {
    const rawValues = Array.from(b.rawValues);
    rawValuesByKey[b.canonicalKey] = rawValues;

    // Prefer the most descriptive label across spellings (a country name beats
    // its ISO code: "United States" over "US").
    const label = rawValues
      .map(displayFromRaw)
      .sort((a, b2) => b2.length - a.length)[0];

    const flagRaw = rawValues.find((v) => locationFlag(v));
    const flagCode = flagRaw ? codeForLocation(stripLeadingThe(flagRaw.trim())) : null;

    return {
      canonicalKey: b.canonicalKey,
      label,
      icon: flagCode ? 'flag' : 'pin',
      flagCode,
      rawValues,
      action: b.action,
    };
  });

  options.sort((a, b) => a.label.localeCompare(b.label));

  // Append "General" last (it's the legacy no-location catch-all, not a place).
  if (generalBuckets.size > 0) {
    const rawValues = Array.from(generalBuckets);
    rawValuesByKey[GENERAL_KEY] = rawValues;
    options.push({
      canonicalKey: GENERAL_KEY,
      label: 'General',
      icon: 'globe',
      flagCode: null,
      rawValues,
      action: { type: 'filter' },
    });
  }

  return { options, rawValuesByKey };
};
