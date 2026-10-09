// World regions for market filters in the edge functions (Ask AI, MCP, the
// quarterly digest). A region is a NAMED GROUP OF COUNTRIES: "Latin America"
// resolves to every tracked Latin American market and the rollups are queried
// with that list of buckets, exactly as a single market is.
//
// Mirror of src/utils/regions.ts — keep the two tables identical.

import { COUNTRY_CODE_TO_NAME } from './countries.ts';

export const REGION_KEY_PREFIX = 'region:';

export type RegionId =
  | 'north-america'
  | 'latin-america'
  | 'europe'
  | 'middle-east-africa'
  | 'asia-pacific';

export interface RegionDef {
  id: RegionId;
  label: string;
  aliases: string[];
}

export const REGIONS: readonly RegionDef[] = [
  { id: 'north-america', label: 'North America', aliases: ['north america', 'na', 'us & canada', 'us and canada'] },
  { id: 'latin-america', label: 'Latin America', aliases: ['latin america', 'latam', 'south america', 'latinoamerica', 'latinoamérica', 'américa latina', 'america latina'] },
  { id: 'europe', label: 'Europe', aliases: ['europe', 'eu', 'european union'] },
  { id: 'middle-east-africa', label: 'Middle East & Africa', aliases: ['middle east & africa', 'middle east and africa', 'mea', 'middle east', 'africa'] },
  { id: 'asia-pacific', label: 'Asia Pacific', aliases: ['asia pacific', 'asia-pacific', 'apac', 'asia', 'asia pac'] },
];

export const COUNTRY_REGION: Record<string, RegionId> = {
  US: 'north-america', CA: 'north-america',
  MX: 'latin-america', BR: 'latin-america', AR: 'latin-america', VE: 'latin-america',
  CL: 'latin-america', CO: 'latin-america', PE: 'latin-america',
  GB: 'europe', IE: 'europe', DE: 'europe', FR: 'europe', IT: 'europe', ES: 'europe',
  PT: 'europe', NL: 'europe', BE: 'europe', CH: 'europe', AT: 'europe', SE: 'europe',
  NO: 'europe', DK: 'europe', FI: 'europe', GR: 'europe', PL: 'europe', CZ: 'europe',
  HU: 'europe', RO: 'europe', BG: 'europe', HR: 'europe', SK: 'europe', SI: 'europe',
  LT: 'europe', LV: 'europe', EE: 'europe', TR: 'europe', RU: 'europe',
  AE: 'middle-east-africa', SA: 'middle-east-africa', IL: 'middle-east-africa',
  ZA: 'middle-east-africa',
  JP: 'asia-pacific', CN: 'asia-pacific', KR: 'asia-pacific', IN: 'asia-pacific',
  SG: 'asia-pacific', MY: 'asia-pacific', TH: 'asia-pacific', PH: 'asia-pacific',
  ID: 'asia-pacific', VN: 'asia-pacific', TW: 'asia-pacific', HK: 'asia-pacific',
  AU: 'asia-pacific', NZ: 'asia-pacific',
};

const BY_ID: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// Lower-cased country name → code, for free-text market spellings.
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_CODE_TO_NAME).map(([code, name]) => [name.toLowerCase(), code]),
);

export const isRegionKey = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.startsWith(REGION_KEY_PREFIX);

export const regionFromKey = (key: string | null | undefined): RegionDef | null => {
  if (!isRegionKey(key)) return null;
  return BY_ID[(key as string).slice(REGION_KEY_PREFIX.length)] ?? null;
};

// Resolve free text ("LATAM", "Latin America", "region:latin-america") to a
// region; null when the text names no region.
export const regionFromText = (text: string | null | undefined): RegionDef | null => {
  if (!text) return null;
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const byKey = regionFromKey(q);
  if (byKey) return byKey;
  return (
    REGIONS.find((r) => r.label.toLowerCase() === q || r.id === q || r.aliases.includes(q)) ?? null
  );
};

// ISO code for a stored market spelling: "IN", "India", "the Netherlands".
// Null for cities, states and anything else that isn't a country.
export const countryCodeForLocation = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^the\s+/i, '').trim();
  if (!stripped) return null;
  const upper = stripped.toUpperCase();
  if (upper.length === 2 && COUNTRY_CODE_TO_NAME[upper]) return upper;
  return NAME_TO_CODE[stripped.toLowerCase()] ?? null;
};

export const regionForCountryCode = (code: string | null | undefined): RegionDef | null => {
  if (!code) return null;
  const id = COUNTRY_REGION[code.toUpperCase()];
  return id ? BY_ID[id] : null;
};

// The tracked market spellings that fall inside a region.
export const bucketsInRegion = (available: string[], region: RegionDef): string[] =>
  available.filter((b) => regionForCountryCode(countryCodeForLocation(b))?.id === region.id);
