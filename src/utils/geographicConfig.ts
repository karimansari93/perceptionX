export interface GeographicSource {
  domain: string;
  country: string;
  region: string;
  primaryLanguage: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  flag: string;
}

export const GEOGRAPHIC_SOURCES: Record<string, GeographicSource> = {
  // North America
  'glassdoor.com': {
    domain: 'glassdoor.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Global job and company review platform (US-based)',
    flag: '🇺🇸'
  },
  'indeed.com': {
    domain: 'indeed.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Global job search platform (US-based)',
    flag: '🇺🇸'
  },
  'linkedin.com': {
    domain: 'linkedin.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Professional networking platform (US-based)',
    flag: '🇺🇸'
  },
  'comparably.com': {
    domain: 'comparably.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Company culture and compensation platform (US-based)',
    flag: '🇺🇸'
  },
  'teamblind.com': {
    domain: 'teamblind.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Anonymous professional networking (US-based)',
    flag: '🇺🇸'
  },
  'fishbowlapp.com': {
    domain: 'fishbowlapp.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Professional networking app (US-based)',
    flag: '🇺🇸'
  },
  'builtin.com': {
    domain: 'builtin.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Tech company platform (US-based)',
    flag: '🇺🇸'
  },
  'greatplacetowork.com': {
    domain: 'greatplacetowork.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Workplace certification organization (US-based)',
    flag: '🇺🇸'
  },
  'vault.com': {
    domain: 'vault.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Career intelligence platform (US-based)',
    flag: '🇺🇸'
  },
  'themuse.com': {
    domain: 'themuse.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Career advice and job platform (US-based)',
    flag: '🇺🇸'
  },

  // Europe
  'kununu.com': {
    domain: 'kununu.com',
    country: 'Germany',
    region: 'Europe',
    primaryLanguage: 'German',
    confidence: 'high',
    description: 'Company review platform (Germany-based)',
    flag: '🇩🇪'
  },
  'stepstone.com': {
    domain: 'stepstone.com',
    country: 'Germany',
    region: 'Europe',
    primaryLanguage: 'German',
    confidence: 'high',
    description: 'Job search platform (Germany-based)',
    flag: '🇩🇪'
  },
  'reed.co.uk': {
    domain: 'reed.co.uk',
    country: 'United Kingdom',
    region: 'Europe',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (UK-based)',
    flag: '🇬🇧'
  },
  'totaljobs.com': {
    domain: 'totaljobs.com',
    country: 'United Kingdom',
    region: 'Europe',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (UK-based)',
    flag: '🇬🇧'
  },
  'monster.co.uk': {
    domain: 'monster.co.uk',
    country: 'United Kingdom',
    region: 'Europe',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (UK-based)',
    flag: '🇬🇧'
  },
  'weloveyourcompany.com': {
    domain: 'weloveyourcompany.com',
    country: 'France',
    region: 'Europe',
    primaryLanguage: 'French',
    confidence: 'high',
    description: 'Company review platform (France-based)',
    flag: '🇫🇷'
  },

  // Asia-Pacific
  'ambitionbox.com': {
    domain: 'ambitionbox.com',
    country: 'India',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Company review and salary platform (India-based)',
    flag: '🇮🇳'
  },
  'naukri.com': {
    domain: 'naukri.com',
    country: 'India',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (India-based)',
    flag: '🇮🇳'
  },
  'timesjobs.com': {
    domain: 'timesjobs.com',
    country: 'India',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (India-based)',
    flag: '🇮🇳'
  },
  'shine.com': {
    domain: 'shine.com',
    country: 'India',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (India-based)',
    flag: '🇮🇳'
  },
  'seek.com.au': {
    domain: 'seek.com.au',
    country: 'Australia',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (Australia-based)',
    flag: '🇦🇺'
  },
  'jobsdb.com': {
    domain: 'jobsdb.com',
    country: 'Singapore',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (Singapore-based)',
    flag: '🇸🇬'
  },
  'jobsdb.com.hk': {
    domain: 'jobsdb.com.hk',
    country: 'Hong Kong',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (Hong Kong-based)',
    flag: '🇭🇰'
  },
  'jobsdb.com.my': {
    domain: 'jobsdb.com.my',
    country: 'Malaysia',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (Malaysia-based)',
    flag: '🇲🇾'
  },
  'jobsdb.com.ph': {
    domain: 'jobsdb.com.ph',
    country: 'Philippines',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (Philippines-based)',
    flag: '🇵🇭'
  },
  'jobsdb.com.sg': {
    domain: 'jobsdb.com.sg',
    country: 'Singapore',
    region: 'Asia-Pacific',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Job search platform (Singapore-based)',
    flag: '🇸🇬'
  },
  'jobsdb.com.th': {
    domain: 'jobsdb.com.th',
    country: 'Thailand',
    region: 'Asia-Pacific',
    primaryLanguage: 'Thai',
    confidence: 'high',
    description: 'Job search platform (Thailand-based)',
    flag: '🇹🇭'
  },
  'jobsdb.com.vn': {
    domain: 'jobsdb.com.vn',
    country: 'Vietnam',
    region: 'Asia-Pacific',
    primaryLanguage: 'Vietnamese',
    confidence: 'high',
    description: 'Job search platform (Vietnam-based)',
    flag: '🇻🇳'
  },
  'jobsdb.com.id': {
    domain: 'jobsdb.com.id',
    country: 'Indonesia',
    region: 'Asia-Pacific',
    primaryLanguage: 'Indonesian',
    confidence: 'high',
    description: 'Job search platform (Indonesia-based)',
    flag: '🇮🇩'
  },

  // News and Media (Global but region-specific)
  'bloomberg.com': {
    domain: 'bloomberg.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Financial news and data (US-based)',
    flag: '🇺🇸'
  },
  'reuters.com': {
    domain: 'reuters.com',
    country: 'United Kingdom',
    region: 'Europe',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'News agency (UK-based)',
    flag: '🇬🇧'
  },
  'techcrunch.com': {
    domain: 'techcrunch.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Technology news (US-based)',
    flag: '🇺🇸'
  },
  'wired.com': {
    domain: 'wired.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Technology magazine (US-based)',
    flag: '🇺🇸'
  },
  'forbes.com': {
    domain: 'forbes.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Business magazine (US-based)',
    flag: '🇺🇸'
  },
  'fortune.com': {
    domain: 'fortune.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Business magazine (US-based)',
    flag: '🇺🇸'
  },
  'wsj.com': {
    domain: 'wsj.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Wall Street Journal (US-based)',
    flag: '🇺🇸'
  },
  'nytimes.com': {
    domain: 'nytimes.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'New York Times (US-based)',
    flag: '🇺🇸'
  },
  'cnn.com': {
    domain: 'cnn.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'CNN News (US-based)',
    flag: '🇺🇸'
  },

  // Social and Community Platforms
  'reddit.com': {
    domain: 'reddit.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Social news aggregation (US-based)',
    flag: '🇺🇸'
  },
  'quora.com': {
    domain: 'quora.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Question and answer platform (US-based)',
    flag: '🇺🇸'
  },
  'stackoverflow.com': {
    domain: 'stackoverflow.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Developer Q&A platform (US-based)',
    flag: '🇺🇸'
  },
  'github.com': {
    domain: 'github.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Code repository platform (US-based)',
    flag: '🇺🇸'
  },
  'medium.com': {
    domain: 'medium.com',
    country: 'United States',
    region: 'North America',
    primaryLanguage: 'English',
    confidence: 'high',
    description: 'Publishing platform (US-based)',
    flag: '🇺🇸'
  }
};

export interface GeographicAnalysis {
  totalSources: number;
  countries: Array<{
    country: string;
    region: string;
    flag: string;
    sources: number;
    percentage: number;
    domains: string[];
  }>;
  regions: Array<{
    region: string;
    sources: number;
    percentage: number;
    countries: string[];
  }>;
  topCountries: Array<{
    country: string;
    flag: string;
    sources: number;
    percentage: number;
  }>;
  geographicInsights: string[];
}

export function analyzeGeographicDistribution(citations: any[]): GeographicAnalysis {
  const domainCounts: Record<string, number> = {};
  const countryCounts: Record<string, { count: number; domains: Set<string>; region: string; flag: string }> = {};
  const regionCounts: Record<string, { count: number; countries: Set<string> }> = {};

  // Process citations to extract domains
  citations.forEach(citation => {
    let domain = '';
    
    if (typeof citation === 'string') {
      domain = extractDomainFromUrl(citation);
    } else if (citation && typeof citation === 'object') {
      if (citation.domain) {
        domain = citation.domain;
      } else if (citation.url) {
        // Prefer extracting domain from URL (more reliable)
        domain = extractDomainFromUrl(citation.url);
      } else if (citation.source) {
        // Only use source name if URL is not available
        const sourceName = citation.source.toLowerCase().trim();
        // Only create domain if source name is valid (not empty)
        if (sourceName && sourceName.length > 0) {
          domain = sourceName + '.com';
        }
      }
    }

    if (domain) {
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      
      const geoSource = GEOGRAPHIC_SOURCES[domain];
      if (geoSource) {
        const country = geoSource.country;
        const region = geoSource.region;
        const flag = geoSource.flag;
        
        if (!countryCounts[country]) {
          countryCounts[country] = { count: 0, domains: new Set(), region, flag };
        }
        countryCounts[country].count++;
        countryCounts[country].domains.add(domain);
        
        if (!regionCounts[region]) {
          regionCounts[region] = { count: 0, countries: new Set() };
        }
        regionCounts[region].count++;
        regionCounts[region].countries.add(country);
      }
    }
  });

  const totalSources = Object.values(domainCounts).reduce((sum, count) => sum + count, 0);

  // Convert to arrays and calculate percentages
  const countries = Object.entries(countryCounts).map(([country, data]) => ({
    country,
    region: data.region,
    flag: data.flag,
    sources: data.count,
    percentage: (data.count / totalSources) * 100,
    domains: Array.from(data.domains)
  })).sort((a, b) => b.sources - a.sources);

  const regions = Object.entries(regionCounts).map(([region, data]) => ({
    region,
    sources: data.count,
    percentage: (data.count / totalSources) * 100,
    countries: Array.from(data.countries)
  })).sort((a, b) => b.sources - a.sources);

  const topCountries = countries.slice(0, 5);

  // Generate insights
  const geographicInsights = generateGeographicInsights(countries, regions, totalSources);

  return {
    totalSources,
    countries,
    regions,
    topCountries,
    geographicInsights
  };
}

function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function generateGeographicInsights(
  countries: Array<{ country: string; sources: number; percentage: number; flag: string }>,
  regions: Array<{ region: string; sources: number; percentage: number }>,
  totalSources: number
): string[] {
  const insights: string[] = [];

  if (countries.length === 0) {
    insights.push('No geographic data available from sources');
    return insights;
  }

  const topCountry = countries[0];
  const topRegion = regions[0];

  // Top country insight
  if (topCountry.percentage > 50) {
    insights.push(`${topCountry.flag} ${topCountry.country} dominates the data with ${topCountry.percentage.toFixed(1)}% of all sources`);
  } else if (topCountry.percentage > 25) {
    insights.push(`${topCountry.flag} ${topCountry.country} is the primary source region with ${topCountry.percentage.toFixed(1)}% of all sources`);
  }

  // Regional distribution
  if (regions.length > 1) {
    const regionDiversity = regions.length;
    if (regionDiversity >= 3) {
      insights.push(`Data shows good geographic diversity across ${regionDiversity} regions`);
    } else if (regionDiversity === 2) {
      insights.push(`Data is concentrated in ${regionDiversity} regions: ${regions.map(r => r.region).join(' and ')}`);
    }
  }

  // Specific platform insights
  const indiaSources = countries.find(c => c.country === 'India');
  const usSources = countries.find(c => c.country === 'United States');
  const europeSources = countries.find(c => c.region === 'Europe');

  if (indiaSources && indiaSources.percentage > 10) {
    insights.push(`🇮🇳 Strong presence from Indian platforms (${indiaSources.percentage.toFixed(1)}%) - likely includes AmbitionBox, Naukri, and other India-focused job sites`);
  }

  if (usSources && usSources.percentage > 30) {
    insights.push(`🇺🇸 US-based platforms dominate (${usSources.percentage.toFixed(1)}%) - primarily Glassdoor, Indeed, and LinkedIn`);
  }

  if (europeSources && europeSources.percentage > 15) {
    insights.push(`🇪🇺 European sources contribute ${europeSources.percentage.toFixed(1)}% of data - includes platforms like Kununu (Germany) and UK job sites`);
  }

  // Language diversity
  const languageCount = new Set(
    countries.map(c => {
      const geoSource = Object.values(GEOGRAPHIC_SOURCES).find(gs => gs.country === c.country);
      return geoSource?.primaryLanguage || 'Unknown';
    })
  ).size;

  if (languageCount > 2) {
    insights.push(`Data spans ${languageCount} different languages, indicating global reach`);
  }

  return insights;
}
