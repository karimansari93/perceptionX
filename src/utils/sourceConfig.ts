export interface SourceConfig {
  domain: string;
  type: 'review-platform' | 'job-board' | 'employer-branding' | 'salary-data' | 'professional-network';
  confidence: 'high' | 'medium' | 'low';
  baseUrl: string;
  displayName: string;
  categories: string[];
}

// Media type definitions
export const MEDIA_TYPE_DESCRIPTIONS = {
  owned: 'Fully controlled by the company (Official website, company blog, career pages)',
  influenced: 'Partially controlled; the company can influence but not fully dictate (e.g. Glassdoor, LinkedIn, Indeed)',
  organic: 'Third-party mentions where the company cannot edit or remove content (e.g. Reddit, Quora)',
  competitive: 'Results owned by talent competitors or sources mentioning competitors instead of the company',
  irrelevant: 'Unrelated search results appearing due to brand name similarities, abbreviations, or algorithmic confusion'
};

export const MEDIA_TYPE_COLORS = {
  owned: 'bg-green-100 text-green-800 border-green-200',
  influenced: 'bg-blue-100 text-blue-800 border-blue-200',
  organic: 'bg-purple-100 text-purple-800 border-purple-200',
  competitive: 'bg-red-100 text-red-800 border-red-200',
  irrelevant: 'bg-gray-100 text-gray-800 border-gray-200'
};

export const EMPLOYMENT_SOURCES: Record<string, SourceConfig> = {
  'glassdoor.com': {
    domain: 'glassdoor.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.glassdoor.com',
    displayName: 'Glassdoor',
    categories: ['reviews', 'salaries', 'interviews', 'benefits']
  },
  'indeed.com': {
    domain: 'indeed.com',
    type: 'job-board',
    confidence: 'high',
    baseUrl: 'https://www.indeed.com',
    displayName: 'Indeed',
    categories: ['reviews', 'jobs', 'salaries']
  },
  'kununu.com': {
    domain: 'kununu.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.kununu.com',
    displayName: 'Kununu',
    categories: ['reviews', 'employer-ratings']
  },
  'themuse.com': {
    domain: 'themuse.com',
    type: 'employer-branding',
    confidence: 'high',
    baseUrl: 'https://www.themuse.com',
    displayName: 'The Muse',
    categories: ['company-profiles', 'career-advice', 'job-listings']
  },
  'seek.com.au': {
    domain: 'seek.com.au',
    type: 'job-board',
    confidence: 'high',
    baseUrl: 'https://www.seek.com.au',
    displayName: 'Seek',
    categories: ['jobs', 'company-reviews']
  },
  'greatplacetowork.com': {
    domain: 'greatplacetowork.com',
    type: 'employer-branding',
    confidence: 'high',
    baseUrl: 'https://www.greatplacetowork.com',
    displayName: 'Great Place to Work',
    categories: ['certification', 'best-companies']
  },
  'builtin.com': {
    domain: 'builtin.com',
    type: 'employer-branding',
    confidence: 'high',
    baseUrl: 'https://www.builtin.com',
    displayName: 'BuiltIn',
    categories: ['tech-companies', 'startups', 'jobs']
  },
  'comparably.com': {
    domain: 'comparably.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.comparably.com',
    displayName: 'Comparably',
    categories: ['reviews', 'salaries', 'culture']
  },
  'vault.com': {
    domain: 'vault.com',
    type: 'employer-branding',
    confidence: 'high',
    baseUrl: 'https://www.vault.com',
    displayName: 'Vault',
    categories: ['rankings', 'company-profiles']
  },
  'fairygodboss.com': {
    domain: 'fairygodboss.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.fairygodboss.com',
    displayName: 'FairyGodBoss',
    categories: ['reviews', 'women-workplace']
  },
  'careerbliss.com': {
    domain: 'careerbliss.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.careerbliss.com',
    displayName: 'CareerBliss',
    categories: ['reviews', 'happiness-index']
  },
  'teamblind.com': {
    domain: 'teamblind.com',
    type: 'professional-network',
    confidence: 'high',
    baseUrl: 'https://www.teamblind.com',
    displayName: 'Blind',
    categories: ['anonymous-reviews', 'tech-industry']
  },
  'jobcase.com': {
    domain: 'jobcase.com',
    type: 'job-board',
    confidence: 'high',
    baseUrl: 'https://www.jobcase.com',
    displayName: 'Jobcase',
    categories: ['jobs', 'community']
  },
  'inhersight.com': {
    domain: 'inhersight.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.inhersight.com',
    displayName: 'InHerSight',
    categories: ['women-workplace', 'reviews']
  },
  'thejobcrowd.com': {
    domain: 'thejobcrowd.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.thejobcrowd.com',
    displayName: 'The Job Crowd',
    categories: ['reviews', 'graduate-jobs']
  },
  'ratemyemployer.com': {
    domain: 'ratemyemployer.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.ratemyemployer.com',
    displayName: 'Rate My Employer',
    categories: ['reviews', 'employer-ratings']
  },
  'ratemyinternship.com': {
    domain: 'ratemyinternship.com',
    type: 'review-platform',
    confidence: 'high',
    baseUrl: 'https://www.ratemyinternship.com',
    displayName: 'Rate My Internship',
    categories: ['internship-reviews']
  },
  'wayup.com': {
    domain: 'wayup.com',
    type: 'job-board',
    confidence: 'high',
    baseUrl: 'https://www.wayup.com',
    displayName: 'WayUp',
    categories: ['internships', 'entry-level-jobs']
  },
  'levels.fyi': {
    domain: 'levels.fyi',
    type: 'salary-data',
    confidence: 'high',
    baseUrl: 'https://www.levels.fyi',
    displayName: 'Levels.fyi',
    categories: ['tech-salaries', 'compensation']
  },
  'fishbowlapp.com': {
    domain: 'fishbowlapp.com',
    type: 'professional-network',
    confidence: 'high',
    baseUrl: 'https://www.fishbowlapp.com',
    displayName: 'Fishbowl',
    categories: ['anonymous-reviews', 'industry-insights']
  },
  'zippia.com': {
    domain: 'zippia.com',
    type: 'job-board',
    confidence: 'high',
    baseUrl: 'https://www.zippia.com',
    displayName: 'Zippia',
    categories: ['jobs', 'company-reviews', 'career-research']
  }
};

// ---------------------------------------------------------------------------
// Focus-chart platform groups (row 2's three small charts). Grouping is by
// PLATFORM, not raw domain, so fr.glassdoor.com, glassdoor.de and
// glassdoor.com read as one Glassdoor row. A bare token ("glassdoor") matches
// the name as a whole domain label in any position — never as a substring, so
// "monster.com" is listed as a dotted token rather than "monster" catching
// monsterenergy.com. A dotted token ("youtu.be") matches that exact domain or
// a subdomain of it.
// ---------------------------------------------------------------------------
export type PlatformGroup = {
  name: string;      // display name for the row
  canonical: string; // domain whose logo represents the platform
  tokens: string[];
};

export const EMPLOYER_REVIEW_PLATFORMS: PlatformGroup[] = [
  { name: 'Glassdoor', canonical: 'glassdoor.com', tokens: ['glassdoor'] },
  { name: 'Indeed', canonical: 'indeed.com', tokens: ['indeed'] },
  { name: 'AmbitionBox', canonical: 'ambitionbox.com', tokens: ['ambitionbox'] },
  { name: 'Kununu', canonical: 'kununu.com', tokens: ['kununu'] },
  { name: 'Comparably', canonical: 'comparably.com', tokens: ['comparably'] },
  { name: 'Blind', canonical: 'teamblind.com', tokens: ['teamblind'] },
  { name: 'Fishbowl', canonical: 'fishbowlapp.com', tokens: ['fishbowlapp'] },
  { name: 'Levels.fyi', canonical: 'levels.fyi', tokens: ['levels.fyi'] },
  { name: 'The Muse', canonical: 'themuse.com', tokens: ['themuse'] },
  { name: 'Seek', canonical: 'seek.com.au', tokens: ['seek'] },
  { name: 'Great Place to Work', canonical: 'greatplacetowork.com', tokens: ['greatplacetowork', 'gptw'] },
  { name: 'Built In', canonical: 'builtin.com', tokens: ['builtin'] },
  { name: 'Vault', canonical: 'vault.com', tokens: ['vault.com'] },
  { name: 'FairyGodBoss', canonical: 'fairygodboss.com', tokens: ['fairygodboss'] },
  { name: 'CareerBliss', canonical: 'careerbliss.com', tokens: ['careerbliss'] },
  { name: 'InHerSight', canonical: 'inhersight.com', tokens: ['inhersight'] },
  { name: 'JobCase', canonical: 'jobcase.com', tokens: ['jobcase'] },
  { name: 'WayUp', canonical: 'wayup.com', tokens: ['wayup'] },
  { name: 'Zippia', canonical: 'zippia.com', tokens: ['zippia'] },
  { name: 'ZipRecruiter', canonical: 'ziprecruiter.com', tokens: ['ziprecruiter'] },
  { name: 'Monster', canonical: 'monster.com', tokens: ['monster.com'] },
  { name: 'CareerBuilder', canonical: 'careerbuilder.com', tokens: ['careerbuilder'] },
  { name: 'SimplyHired', canonical: 'simplyhired.com', tokens: ['simplyhired'] },
  { name: 'Dice', canonical: 'dice.com', tokens: ['dice.com'] },
  { name: 'Naukri', canonical: 'naukri.com', tokens: ['naukri', 'naukrigulf'] },
  { name: 'JobStreet', canonical: 'jobstreet.com', tokens: ['jobstreet'] },
  { name: 'StepStone', canonical: 'stepstone.de', tokens: ['stepstone'] },
  { name: 'Welcome to the Jungle', canonical: 'welcometothejungle.com', tokens: ['welcometothejungle'] },
  { name: 'The Job Crowd', canonical: 'thejobcrowd.com', tokens: ['thejobcrowd'] },
  { name: 'Rate My Employer', canonical: 'ratemyemployer.com', tokens: ['ratemyemployer'] },

  // Added after a sweep of cited domains in the data. Regional review sites
  // that are the top employer source in their own market but were missing.
  // Japan
  { name: 'OpenWork', canonical: 'openwork.jp', tokens: ['openwork.jp', 'en-hyouban.com'] },
  { name: 'JobTalk', canonical: 'jobtalk.jp', tokens: ['jobtalk'] },
  { name: 'Syukatsu Kaigi', canonical: 'syukatsu-kaigi.jp', tokens: ['syukatsu-kaigi.jp'] },
  { name: 'ONE CAREER', canonical: 'onecareer.jp', tokens: ['onecareer'] },
  // Korea
  { name: 'JobPlanet', canonical: 'jobplanet.co.kr', tokens: ['jobplanet'] },
  { name: 'JobKorea', canonical: 'jobkorea.co.kr', tokens: ['jobkorea'] },
  // Europe
  { name: 'GoWork.pl', canonical: 'gowork.pl', tokens: ['gowork'] },
  { name: 'Undelucram', canonical: 'undelucram.ro', tokens: ['undelucram'] },
  { name: 'Profession.hu', canonical: 'profession.hu', tokens: ['profession.hu'] },
  { name: 'Where We Work', canonical: 'wherewework.hu', tokens: ['wherewework'] },
  { name: 'ChooseMyCompany', canonical: 'choosemycompany.com', tokens: ['choosemycompany'] },
  { name: 'InfoJobs', canonical: 'infojobs.com.br', tokens: ['infojobs'] },
  // Latin America
  { name: 'Merco Talento', canonical: 'merco.info', tokens: ['merco.info'] },
  { name: 'Computrabajo', canonical: 'computrabajo.com', tokens: ['computrabajo'] },
  { name: 'Bumeran', canonical: 'bumeran.com', tokens: ['bumeran'] },
  { name: 'elempleo', canonical: 'elempleo.com', tokens: ['elempleo'] },
  { name: 'OCC Mundial', canonical: 'occ.com.mx', tokens: ['occ.com.mx'] },
  { name: 'Catho', canonical: 'catho.com.br', tokens: ['catho.com.br'] },
  { name: 'Vagas', canonical: 'vagas.com.br', tokens: ['vagas.com.br'] },
  // Asia-Pacific and Middle East
  { name: 'WorkVenture', canonical: 'workventure.com', tokens: ['workventure'] },
  { name: 'JobsDB', canonical: 'jobsdb.com', tokens: ['jobsdb'] },
  { name: 'Shine', canonical: 'shine.com', tokens: ['shine.com'] },
  { name: 'Foundit', canonical: 'foundit.in', tokens: ['foundit.in'] },
  { name: 'Bayt', canonical: 'bayt.com', tokens: ['bayt.com'] },
  { name: 'GulfTalent', canonical: 'gulftalent.com', tokens: ['gulftalent.com'] },
  // North America and UK: salary, culture and employer rankings
  { name: 'Payscale', canonical: 'payscale.com', tokens: ['payscale'] },
  { name: 'Salary.com', canonical: 'salary.com', tokens: ['salary.com'] },
  { name: 'RepVue', canonical: 'repvue.com', tokens: ['repvue'] },
  { name: 'Taro', canonical: 'jointaro.com', tokens: ['jointaro'] },
  { name: "Canada's Top 100 Employers", canonical: 'canadastop100.com', tokens: ['canadastop100'] },
  { name: 'Top Employers Institute', canonical: 'top-employers.com', tokens: ['top-employers.com'] },
  { name: 'Top Workplaces', canonical: 'topworkplaces.com', tokens: ['topworkplaces.com'] },
  { name: 'Arbeitgeber-Ranking', canonical: 'arbeitgeber-ranking.de', tokens: ['arbeitgeber-ranking.de'] },
  { name: 'WORK180', canonical: 'work180.com', tokens: ['work180'] },
  { name: 'Handshake', canonical: 'joinhandshake.com', tokens: ['joinhandshake'] },
  { name: 'Totaljobs', canonical: 'totaljobs.com', tokens: ['totaljobs'] },
  { name: 'Reed', canonical: 'reed.co.uk', tokens: ['reed.co.uk'] },
  { name: 'Jobs.ch', canonical: 'jobs.ch', tokens: ['jobs.ch'] },
];

export const domainMatchesPlatformToken = (domain: string, token: string): boolean => {
  if (token.includes('.')) {
    return domain === token || domain.endsWith(`.${token}`);
  }
  return (
    domain === token ||
    domain.startsWith(`${token}.`) ||   // glassdoor.com, glassdoor.in
    domain.includes(`.${token}.`) ||    // fr.glassdoor.com
    domain.endsWith(`.${token}`)
  );
};

// Platforms in the list above that people post on anonymously: the company
// cannot shape them, so they stay Organic rather than Influenced.
const ORGANIC_EMPLOYER_PLATFORMS = new Set(["Blind", "Fishbowl"]);

// Function to categorize any domain by media type based on response data
export function categorizeSourceByMediaType(
  domain: string, 
  responses: any[] = [], 
  companyName?: string
): 'owned' | 'influenced' | 'organic' | 'competitive' | 'irrelevant' {
  
  // Check if we have response data to determine competitive vs non-competitive
  if (responses.length > 0) {
    // Check if this domain is primarily competitive (company_mentioned = false)
    const domainResponses = responses.filter(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        return Array.isArray(citations) && citations.some((c: any) => c.domain === domain);
      } catch {
        return false;
      }
    });

    if (domainResponses.length > 0) {
      // Count competitive vs non-competitive responses for this domain
      const competitiveCount = domainResponses.filter(r => r.company_mentioned === false).length;
      const nonCompetitiveCount = domainResponses.filter(r => r.company_mentioned === true).length;
      
      // If more than 60% of responses are competitive, mark as competitive
      if (competitiveCount > nonCompetitiveCount && competitiveCount > 0) {
        return 'competitive';
      }
    }
  }

  // Check if it's likely owned by the company - this should be checked BEFORE known sources
  if (companyName) {
    const companyNameLower = companyName.toLowerCase().trim();
    const domainLower = domain.toLowerCase();
    
    // Remove common company suffixes and clean the company name
    const cleanCompanyName = companyNameLower
      .replace(/\s+(inc|llc|ltd|corp|corporation|company|co|group|international|global|technologies|systems|solutions|software|games|entertainment|studios)\b/g, '')
      .replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric characters
    
    // Check for exact company name match in domain
    if (domainLower.includes(cleanCompanyName) || domainLower === cleanCompanyName) {
      return 'owned';
    }
    
    // Check for company name with common TLDs
    const commonTlds = ['.com', '.org', '.net', '.io', '.co', '.ai', '.app', '.tech', '.dev'];
    for (const tld of commonTlds) {
      if (domainLower === cleanCompanyName + tld) {
        return 'owned';
      }
    }
    
    // Check for company name with subdomains
    if (domainLower.includes('.' + cleanCompanyName) || domainLower.includes(cleanCompanyName + '.')) {
      return 'owned';
    }
    
    // Check for common company domain patterns
    if (domainLower.includes('careers') || 
        domainLower.includes('jobs') || 
        domainLower.includes('about') ||
        domainLower.includes('company') ||
        domainLower.includes('team')) {
      // Only mark as owned if it also contains the company name
      if (domainLower.includes(cleanCompanyName)) {
        return 'owned';
      }
    }
    
    // Additional check: try to extract company name from domain and see if it matches
    const domainParts = domainLower.split('.');
    const mainDomain = domainParts[0]; // e.g., "acmetechnologies" from "acmetechnologies.com"
    
    // Check if main domain contains the cleaned company name
    if (mainDomain.includes(cleanCompanyName)) {
      return 'owned';
    }
    
    // Check if cleaned company name contains the main domain (for shorter company names)
    if (cleanCompanyName.includes(mainDomain) && mainDomain.length > 2) {
      return 'owned';
    }
  }

  // Check if it's a known employment source
  const knownSource = EMPLOYMENT_SOURCES[domain];
  if (knownSource) {
    // Most employment sources are influenced, but some could be organic
    if (domain === 'teamblind.com' || domain === 'fishbowlapp.com') {
      return 'organic';
    }
    return 'influenced';
  }

  // Any platform on the employer review list (including regional variants and
  // local sites such as OpenWork or JobPlanet) is Influenced, the same as
  // Glassdoor. This keeps Source type in step with the review sites card.
  const reviewPlatform = EMPLOYER_REVIEW_PLATFORMS.find((p) =>
    p.tokens.some((t) => domainMatchesPlatformToken(domain.toLowerCase(), t))
  );
  if (reviewPlatform) {
    return ORGANIC_EMPLOYER_PLATFORMS.has(reviewPlatform.name) ? 'organic' : 'influenced';
  }

  // Check for domains containing employment platform keywords (influenced)
  const employmentKeywords = ['glassdoor', 'indeed', 'ambitionbox'];
  if (employmentKeywords.some(keyword => domain.includes(keyword))) {
    return 'influenced';
  }

  // Check for social media and content platforms (organic)
  const organicPlatforms = [
    'reddit.com', 'quora.com', 'twitter.com', 'x.com', 'facebook.com', 
    'instagram.com', 'youtube.com', 'medium.com', 'substack.com',
    'hackernews.com', 'news.ycombinator.com', 'stackoverflow.com', 'github.com'
  ];
  
  if (organicPlatforms.some(platform => domain.includes(platform))) {
    return 'organic';
  }

  // Check for news and media sites (organic)
  const newsDomains = [
    'news', 'media', 'press', 'blog', 'article', 'story', 'report'
  ];
  
  if (newsDomains.some(keyword => domain.includes(keyword))) {
    return 'organic';
  }

  // Default to organic for unknown domains
  return 'organic';
}

// Function to get media type display information
export function getMediaTypeInfo(mediaType: string) {
  return {
    label: mediaType.charAt(0).toUpperCase() + mediaType.slice(1),
    description: MEDIA_TYPE_DESCRIPTIONS[mediaType as keyof typeof MEDIA_TYPE_DESCRIPTIONS] || '',
    colors: MEDIA_TYPE_COLORS[mediaType as keyof typeof MEDIA_TYPE_COLORS] || MEDIA_TYPE_COLORS.irrelevant
  };
}
