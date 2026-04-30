/**
 * Shared country code ↔ name mappings for edge functions.
 *
 * Single source of truth — imported by:
 *   - collect-industry-visibility
 *   - process-visibility-queue
 *   - process-company-batch-queue
 *
 * Lookups are graceful fallbacks: if a value matches a known code (US, GB),
 * it expands to the full name. If it doesn't match (e.g. "California", "Dubai"),
 * the value passes through as-is. This supports both country codes and free-text
 * locations used by the Company Batch Collection feature.
 */

/** Country code → full English name (e.g. "US" → "United States") */
export const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  CH: "Switzerland",
  AT: "Austria",
  BE: "Belgium",
  IE: "Ireland",
  NZ: "New Zealand",
  SG: "Singapore",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  IN: "India",
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  ZA: "South Africa",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  PT: "Portugal",
  PL: "Poland",
  CZ: "Czech Republic",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  HR: "Croatia",
  SK: "Slovakia",
  SI: "Slovenia",
  LT: "Lithuania",
  LV: "Latvia",
  EE: "Estonia",
  GR: "Greece",
  TR: "Turkey",
  RU: "Russia",
  IL: "Israel",
  TH: "Thailand",
  ID: "Indonesia",
  VN: "Vietnam",
  TW: "Taiwan",
  HK: "Hong Kong",
  MY: "Malaysia",
  PH: "Philippines",
  CL: "Chile",
  CO: "Colombia",
  PE: "Peru",
  GLOBAL: "Global (All Countries)",
};

/** Full English name → country code (e.g. "United States" → "US") */
export const COUNTRY_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_CODE_TO_NAME).map(([code, name]) => [name, code])
);

/**
 * Resolve a location value to a display name.
 *
 * - Known country code (e.g. "US") → expanded name ("United States")
 * - Explicit countryName override → used directly
 * - Free-text location (e.g. "California", "Dubai") → passed through as-is
 *
 * This means the function never fails — unrecognized values are used verbatim,
 * which is exactly what the batch collection feature needs for arbitrary locations.
 */
export function resolveCountryName(
  location: string,
  countryName?: string | null
): string {
  if (countryName) return countryName;
  return COUNTRY_CODE_TO_NAME[location] || location;
}
