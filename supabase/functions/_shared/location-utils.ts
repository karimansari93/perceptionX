/**
 * Helper functions for mapping country codes to SerpAPI location parameters
 */

// Map country codes to localized search term suffixes
const COUNTRY_SEARCH_TERMS: Record<string, { careers: string; jobs: string }> = {
  'US': { careers: 'careers', jobs: 'jobs' },
  'GB': { careers: 'careers', jobs: 'jobs' },
  'CA': { careers: 'careers', jobs: 'jobs' },
  'AU': { careers: 'careers', jobs: 'jobs' },
  'NZ': { careers: 'careers', jobs: 'jobs' },
  'IE': { careers: 'careers', jobs: 'jobs' },
  'ZA': { careers: 'careers', jobs: 'jobs' },
  'DE': { careers: 'karriere', jobs: 'stellenangebote' },
  'AT': { careers: 'karriere', jobs: 'stellenangebote' },
  'CH': { careers: 'karriere', jobs: 'stellenangebote' },
  'FR': { careers: 'carrières', jobs: 'emplois' },
  'BE': { careers: 'carrières', jobs: 'emplois' }, // French-speaking Belgium
  'IT': { careers: 'carriere', jobs: 'lavoro' },
  'ES': { careers: 'carreras', jobs: 'trabajos' },
  'PT': { careers: 'carreiras', jobs: 'empregos' },
  'BR': { careers: 'carreiras', jobs: 'vagas' },
  'NL': { careers: 'carrière', jobs: 'banen' },
  'PL': { careers: 'kariera', jobs: 'praca' },
  'CZ': { careers: 'kariéra', jobs: 'pracovní místa' },
  'HU': { careers: 'karrier', jobs: 'állások' },
  'RO': { careers: 'cariere', jobs: 'locuri de munca' },
  'BG': { careers: 'кариера', jobs: 'работа' },
  'HR': { careers: 'karijera', jobs: 'poslovi' },
  'SK': { careers: 'kariéra', jobs: 'práca' },
  'SI': { careers: 'kariera', jobs: 'zaposlitve' },
  'LT': { careers: 'karjera', jobs: 'darbo' },
  'LV': { careers: 'karjera', jobs: 'darbi' },
  'EE': { careers: 'karjäär', jobs: 'töökohad' },
  'FI': { careers: 'ura', jobs: 'työpaikat' },
  'SE': { careers: 'karriär', jobs: 'jobb' },
  'NO': { careers: 'karriere', jobs: 'stillinger' },
  'DK': { careers: 'karriere', jobs: 'job' },
  'GR': { careers: 'καριέρα', jobs: 'θέσεις εργασίας' },
  'JP': { careers: 'キャリア', jobs: '求人' },
  'CN': { careers: '职业', jobs: '工作' },
  'KR': { careers: '채용', jobs: '구인' },
  'IN': { careers: 'careers', jobs: 'jobs' }, // English is common
  'SG': { careers: 'careers', jobs: 'jobs' }, // English is common
  'MY': { careers: 'careers', jobs: 'jobs' }, // English is common
  'TH': { careers: 'อาชีพ', jobs: 'งาน' },
  'PH': { careers: 'careers', jobs: 'jobs' }, // English is common
  'ID': { careers: 'karir', jobs: 'lowongan' },
  'VN': { careers: 'nghề nghiệp', jobs: 'việc làm' },
  'TW': { careers: '職涯', jobs: '工作' },
  'HK': { careers: 'careers', jobs: 'jobs' }, // English is common
  'MX': { careers: 'carreras', jobs: 'trabajos' },
  'AR': { careers: 'carreras', jobs: 'trabajos' },
  'CL': { careers: 'carreras', jobs: 'trabajos' },
  'CO': { careers: 'carreras', jobs: 'trabajos' },
  'PE': { careers: 'carreras', jobs: 'trabajos' },
  'AE': { careers: 'careers', jobs: 'jobs' }, // English is common
  'SA': { careers: 'careers', jobs: 'jobs' }, // English is common
  'IL': { careers: 'קריירה', jobs: 'משרות' },
  'TR': { careers: 'kariyer', jobs: 'iş ilanları' },
  'RU': { careers: 'карьера', jobs: 'вакансии' },
  'GLOBAL': { careers: 'careers', jobs: 'jobs' }, // Default to English
};

/**
 * Get localized search term suffixes for a country
 * @param countryCode - ISO country code (e.g., 'US', 'GB', 'DE') or 'GLOBAL'
 * @returns Object with 'careers' and 'jobs' terms in the local language
 */
export function getLocalizedSearchTerms(countryCode: string | null | undefined): { careers: string; jobs: string } {
  const code = (countryCode || 'GLOBAL').toUpperCase();
  return COUNTRY_SEARCH_TERMS[code] || COUNTRY_SEARCH_TERMS['GLOBAL'];
}

/**
 * Get country-specific search terms for better relevance
 * Returns more contextual terms beyond just "careers" and "jobs"
 * @param companyName - Name of the company
 * @param countryCode - ISO country code
 * @returns Array of localized search terms relevant to the country
 */
export function getCountrySpecificSearchTerms(companyName: string, countryCode: string | null | undefined): string[] {
  const code = (countryCode || 'GLOBAL').toUpperCase();
  const localizedTerms = getLocalizedSearchTerms(code);
  
  // Base terms that work for most countries
  const baseTerms = [
    `${companyName} ${localizedTerms.careers}`,
    `${companyName} ${localizedTerms.jobs}`
  ];
  
  // Country-specific additional terms for better relevance
  const countrySpecificTerms: Record<string, string[]> = {
    'DE': [
      `${companyName} kununu`,
      `${companyName} stepstone`,
      `${companyName} arbeitgeber`,
      `${companyName} bewertungen`
    ],
    'GB': [
      `${companyName} reed.co.uk`,
      `${companyName} totaljobs`,
      `${companyName} glassdoor uk`,
      `${companyName} employee reviews`
    ],
    'FR': [
      `${companyName} weloveyourcompany`,
      `${companyName} apec`,
      `${companyName} avis employés`,
      `${companyName} recrutement`
    ],
    'IN': [
      `${companyName} ambitionbox`,
      `${companyName} naukri`,
      `${companyName} glassdoor india`,
      `${companyName} employee reviews`
    ],
    'ES': [
      `${companyName} infojobs`,
      `${companyName} glassdoor españa`,
      `${companyName} opiniones empleados`
    ],
    'IT': [
      `${companyName} glassdoor italia`,
      `${companyName} recensioni dipendenti`
    ],
    'NL': [
      `${companyName} glassdoor nederland`,
      `${companyName} werknemersbeoordelingen`
    ],
    'CA': [
      `${companyName} glassdoor canada`,
      `${companyName} indeed canada`,
      `${companyName} employee reviews`
    ],
    'AU': [
      `${companyName} glassdoor australia`,
      `${companyName} seek`,
      `${companyName} employee reviews`
    ],
    'BR': [
      `${companyName} glassdoor brasil`,
      `${companyName} avaliações funcionários`
    ],
    'MX': [
      `${companyName} glassdoor méxico`,
      `${companyName} opiniones empleados`
    ],
    'JP': [
      `${companyName} glassdoor 日本`,
      `${companyName} 従業員レビュー`,
      `${companyName} 求人`
    ],
    'CN': [
      `${companyName} glassdoor 中国`,
      `${companyName} 员工评价`
    ],
    'KR': [
      `${companyName} glassdoor 한국`,
      `${companyName} 직원 리뷰`
    ],
    'SG': [
      `${companyName} glassdoor singapore`,
      `${companyName} employee reviews`
    ],
    'HU': [
      `${companyName} glassdoor hungary`,
      `${companyName} állásportál`,
      `${companyName} munkáltató értékelés`
    ],
    'PL': [
      `${companyName} glassdoor polska`,
      `${companyName} praca`,
      `${companyName} opinie pracowników`
    ],
    'CZ': [
      `${companyName} glassdoor česko`,
      `${companyName} práce`,
      `${companyName} hodnocení zaměstnavatele`
    ],
    'RO': [
      `${companyName} glassdoor românia`,
      `${companyName} locuri de muncă`,
      `${companyName} recenzii angajați`
    ],
    'US': [
      `${companyName} glassdoor`,
      `${companyName} indeed`,
      `${companyName} employee reviews`,
      `${companyName} company culture`
    ]
  };
  
  // Get country-specific terms or use base terms
  const additionalTerms = countrySpecificTerms[code] || [];
  
  // Combine and return unique terms
  return [...baseTerms, ...additionalTerms].slice(0, 4); // Limit to 4 most relevant terms
}

// Map country codes to Google country codes (gl parameter)
const COUNTRY_TO_GL: Record<string, string> = {
  'US': 'us',
  'GB': 'uk',
  'CA': 'ca',
  'AU': 'au',
  'DE': 'de',
  'FR': 'fr',
  'IT': 'it',
  'ES': 'es',
  'NL': 'nl',
  'BE': 'be',
  'CH': 'ch',
  'AT': 'at',
  'SE': 'se',
  'NO': 'no',
  'DK': 'dk',
  'FI': 'fi',
  'PL': 'pl',
  'IE': 'ie',
  'PT': 'pt',
  'GR': 'gr',
  'CZ': 'cz',
  'HU': 'hu',
  'RO': 'ro',
  'BG': 'bg',
  'HR': 'hr',
  'SK': 'sk',
  'SI': 'si',
  'LT': 'lt',
  'LV': 'lv',
  'EE': 'ee',
  'JP': 'jp',
  'CN': 'cn',
  'KR': 'kr',
  'IN': 'in',
  'SG': 'sg',
  'MY': 'my',
  'TH': 'th',
  'PH': 'ph',
  'ID': 'id',
  'VN': 'vn',
  'TW': 'tw',
  'HK': 'hk',
  'NZ': 'nz',
  'ZA': 'za',
  'BR': 'br',
  'MX': 'mx',
  'AR': 'ar',
  'CL': 'cl',
  'CO': 'co',
  'PE': 'pe',
  'AE': 'ae',
  'SA': 'sa',
  'IL': 'il',
  'TR': 'tr',
  'RU': 'ru',
  'GLOBAL': 'us', // Default to US for global
};

// Map country codes to language codes (hl parameter)
const COUNTRY_TO_HL: Record<string, string> = {
  'US': 'en',
  'GB': 'en',
  'CA': 'en',
  'AU': 'en',
  'NZ': 'en',
  'IE': 'en',
  'ZA': 'en',
  'DE': 'de',
  'AT': 'de',
  'CH': 'de',
  'FR': 'fr',
  'IT': 'it',
  'ES': 'es',
  'PT': 'pt',
  'BR': 'pt',
  'NL': 'nl',
  'BE': 'nl', // Belgium - defaulting to Dutch (nl), can also use French (fr)
  'PL': 'pl',
  'CZ': 'cs',
  'HU': 'hu',
  'RO': 'ro',
  'BG': 'bg',
  'HR': 'hr',
  'SK': 'sk',
  'SI': 'sl',
  'LT': 'lt',
  'LV': 'lv',
  'EE': 'et',
  'FI': 'fi',
  'SE': 'sv',
  'NO': 'no',
  'DK': 'da',
  'GR': 'el',
  'JP': 'ja',
  'CN': 'zh',
  'KR': 'ko',
  'IN': 'en',
  'SG': 'en',
  'MY': 'en',
  'TH': 'th',
  'PH': 'en',
  'ID': 'id',
  'VN': 'vi',
  'TW': 'zh-TW',
  'HK': 'zh-HK',
  'MX': 'es',
  'AR': 'es',
  'CL': 'es',
  'CO': 'es',
  'PE': 'es',
  'AE': 'ar',
  'SA': 'ar',
  'IL': 'he',
  'TR': 'tr',
  'RU': 'ru',
  'GLOBAL': 'en', // Default to English for global
};

// Map country codes to human-readable location strings for SerpAPI location parameter
const COUNTRY_TO_LOCATION: Record<string, string> = {
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
  'PL': 'Poland',
  'IE': 'Ireland',
  'PT': 'Portugal',
  'GR': 'Greece',
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
  'TW': 'Taiwan',
  'HK': 'Hong Kong',
  'NZ': 'New Zealand',
  'ZA': 'South Africa',
  'BR': 'Brazil',
  'MX': 'Mexico',
  'AR': 'Argentina',
  'CL': 'Chile',
  'CO': 'Colombia',
  'PE': 'Peru',
  'AE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'IL': 'Israel',
  'TR': 'Turkey',
  'RU': 'Russia',
  'GLOBAL': 'United States', // Default to US for global
};

export interface SerpAPILocationParams {
  gl?: string; // Google country code
  hl?: string; // Language code
  location?: string; // Human-readable location
}

/**
 * Convert country code to SerpAPI location parameters
 * @param countryCode - ISO country code (e.g., 'US', 'GB', 'CA') or 'GLOBAL'
 * @returns SerpAPI location parameters object
 */
export function getSerpAPILocationParams(countryCode: string | null | undefined): SerpAPILocationParams {
  // Default to GLOBAL if no country provided
  const code = (countryCode || 'GLOBAL').toUpperCase();
  
  const gl = COUNTRY_TO_GL[code] || 'us';
  const hl = COUNTRY_TO_HL[code] || 'en';
  const location = COUNTRY_TO_LOCATION[code] || 'United States';
  
  return {
    gl,
    hl,
    location,
  };
}

/**
 * Build SerpAPI URL with location parameters
 * @param baseUrl - Base SerpAPI URL
 * @param searchTerm - Search query
 * @param apiKey - SerpAPI key
 * @param countryCode - ISO country code
 * @param numResults - Number of results (default: 10)
 * @returns Complete SerpAPI URL with location parameters
 */
export function buildSerpAPIUrl(
  baseUrl: string,
  searchTerm: string,
  apiKey: string,
  countryCode: string | null | undefined,
  numResults: number = 10
): string {
  const params = getSerpAPILocationParams(countryCode);
  
  const url = new URL(baseUrl);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', searchTerm);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('num', numResults.toString());
  
  // Add location parameters - gl and hl are sufficient for localization
  // Note: location parameter is optional and not supported for all countries (e.g., Czech Republic)
  // Using only gl and hl ensures compatibility across all countries
  if (params.gl) {
    url.searchParams.set('gl', params.gl);
  }
  if (params.hl) {
    url.searchParams.set('hl', params.hl);
  }
  // Removed location parameter to avoid errors for unsupported countries
  // gl (Google country code) and hl (language) are sufficient for country-specific results
  
  return url.toString();
}

/**
 * Get country code for Keywords Everywhere API
 * @param countryCode - ISO country code
 * @returns Keywords Everywhere country code (default: 'us')
 */
export function getKeywordsEverywhereCountry(countryCode: string | null | undefined): string {
  const code = (countryCode || 'GLOBAL').toUpperCase();
  
  // Keywords Everywhere uses lowercase country codes
  const mapping: Record<string, string> = {
    'US': 'us',
    'GB': 'gb',
    'CA': 'ca',
    'AU': 'au',
    'DE': 'de',
    'FR': 'fr',
    'IT': 'it',
    'ES': 'es',
    'NL': 'nl',
    'BE': 'be',
    'CH': 'ch',
    'AT': 'at',
    'SE': 'se',
    'NO': 'no',
    'DK': 'dk',
    'FI': 'fi',
    'PL': 'pl',
    'IE': 'ie',
    'PT': 'pt',
    'GR': 'gr',
    'JP': 'jp',
    'CN': 'cn',
    'KR': 'kr',
    'IN': 'in',
    'SG': 'sg',
    'MY': 'my',
    'TH': 'th',
    'PH': 'ph',
    'ID': 'id',
    'VN': 'vn',
    'TW': 'tw',
    'HK': 'hk',
    'NZ': 'nz',
    'ZA': 'za',
    'BR': 'br',
    'MX': 'mx',
    'AR': 'ar',
    'CL': 'cl',
    'CO': 'co',
    'PE': 'pe',
    'GLOBAL': 'us',
  };
  
  return mapping[code] || 'us';
}

