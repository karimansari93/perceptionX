// Shared helpers for working with company "locations" (country codes).
//
// A company record in this app is a (name, country) tuple — e.g. "Netflix" in
// Japan and "Netflix" in the US are two separate rows sharing a name. The
// dashboard's location filter is expressed as a country code, or `null` for the
// country-agnostic "Global" view. These helpers normalize between a company's
// stored `country` value and that filter representation, and map codes to names.

// Country-agnostic sentinels that all collapse to the single "Global" view.
export const GLOBAL_LIKE = new Set(['GLOBAL', 'Global', 'Global (All Countries)', 'Worldwide']);

// Normalize a company's `country` field to a location-filter value.
// Returns `null` for global/empty companies and the country code otherwise.
export const countryToLocation = (country: string | null | undefined): string | null => {
  if (!country || GLOBAL_LIKE.has(country)) return null;
  return country;
};

// Country code → display name (e.g. 'US' → 'United States').
export const getCountryName = (code: string): string => {
  const countryNames: Record<string, string> = {
    'GLOBAL': 'Global',
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'IE': 'Ireland',
    'PT': 'Portugal',
    'GR': 'Greece',
    'PL': 'Poland',
    'CZ': 'Czech Republic',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'LT': 'Lithuania',
    'LV': 'Latvia',
    'EE': 'Estonia',
    'JP': 'Japan',
    'CN': 'China',
    'KR': 'South Korea',
    'IN': 'India',
    'SG': 'Singapore',
    'MY': 'Malaysia',
    'TH': 'Thailand',
    'PH': 'Philippines',
    'ID': 'Indonesia',
    'VN': 'Vietnam',
    'MX': 'Mexico',
    'BR': 'Brazil',
    'AR': 'Argentina',
    'VE': 'Venezuela',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'AE': 'United Arab Emirates',
    'SA': 'Saudi Arabia',
    'ZA': 'South Africa',
    'NZ': 'New Zealand',
    'TR': 'Turkey',
    'RU': 'Russia',
  };
  return countryNames[code] || code;
};
