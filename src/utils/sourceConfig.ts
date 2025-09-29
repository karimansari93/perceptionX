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
