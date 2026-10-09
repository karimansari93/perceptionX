// World regions for the Location filter.
//
// A region is a NAMED GROUP OF COUNTRIES, nothing more: selecting "Latin
// America" filters by the union of the tracked Latin American markets (Brazil
// + Mexico + …), using exactly the same rollup queries a single country uses.
// The grouping is fixed here (not per organization), so a brand that starts
// tracking a new market lands in the right region on its own.
//
// Region entries live in the same dropdown as countries and are identified by
// a prefixed canonical key ("region:latin-america") so they can be stored
// anywhere a country key is stored today (starred view, profile focus).
//
// Mirrored for the edge functions in supabase/functions/_shared/regions.ts —
// keep the two tables identical.

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
  // Lower-cased ways people name the region (Ask AI, saved views typed by
  // hand). The label itself always matches.
  aliases: string[];
}

export const REGIONS: readonly RegionDef[] = [
  { id: 'north-america', label: 'North America', aliases: ['north america', 'na', 'us & canada', 'us and canada'] },
  { id: 'latin-america', label: 'Latin America', aliases: ['latin america', 'latam', 'south america', 'latinoamerica', 'latinoamérica', 'américa latina', 'america latina'] },
  { id: 'europe', label: 'Europe', aliases: ['europe', 'eu', 'european union'] },
  { id: 'middle-east-africa', label: 'Middle East & Africa', aliases: ['middle east & africa', 'middle east and africa', 'mea', 'middle east', 'africa'] },
  { id: 'asia-pacific', label: 'Asia Pacific', aliases: ['asia pacific', 'asia-pacific', 'apac', 'asia', 'asia pac'] },
];

// ISO 3166-1 alpha-2 country code → region.
export const COUNTRY_REGION: Record<string, RegionId> = {
  // North America
  US: 'north-america', CA: 'north-america',
  // Latin America
  MX: 'latin-america', BR: 'latin-america', AR: 'latin-america', VE: 'latin-america',
  CL: 'latin-america', CO: 'latin-america', PE: 'latin-america',
  // Europe
  GB: 'europe', IE: 'europe', DE: 'europe', FR: 'europe', IT: 'europe', ES: 'europe',
  PT: 'europe', NL: 'europe', BE: 'europe', CH: 'europe', AT: 'europe', SE: 'europe',
  NO: 'europe', DK: 'europe', FI: 'europe', GR: 'europe', PL: 'europe', CZ: 'europe',
  HU: 'europe', RO: 'europe', BG: 'europe', HR: 'europe', SK: 'europe', SI: 'europe',
  LT: 'europe', LV: 'europe', EE: 'europe', TR: 'europe', RU: 'europe',
  // Middle East & Africa
  AE: 'middle-east-africa', SA: 'middle-east-africa', IL: 'middle-east-africa',
  ZA: 'middle-east-africa',
  // Asia Pacific
  JP: 'asia-pacific', CN: 'asia-pacific', KR: 'asia-pacific', IN: 'asia-pacific',
  SG: 'asia-pacific', MY: 'asia-pacific', TH: 'asia-pacific', PH: 'asia-pacific',
  ID: 'asia-pacific', VN: 'asia-pacific', TW: 'asia-pacific', HK: 'asia-pacific',
  AU: 'asia-pacific', NZ: 'asia-pacific',
};

const BY_ID: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export const regionKey = (id: RegionId): string => `${REGION_KEY_PREFIX}${id}`;

export const isRegionKey = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.startsWith(REGION_KEY_PREFIX);

// The region a canonical key names, or null for anything that isn't a
// well-formed region key.
export const regionFromKey = (key: string | null | undefined): RegionDef | null => {
  if (!isRegionKey(key)) return null;
  return BY_ID[(key as string).slice(REGION_KEY_PREFIX.length)] ?? null;
};

export const regionForCountryCode = (code: string | null | undefined): RegionDef | null => {
  if (!code) return null;
  const id = COUNTRY_REGION[code.toUpperCase()];
  return id ? BY_ID[id] : null;
};

// Resolve free text ("LATAM", "Latin America", "region:latin-america") to a
// region. Case-insensitive; null when the text names no region.
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
