export interface SourceConfig {
  domain: string;
  type: 'review-platform' | 'job-board' | 'employer-branding' | 'salary-data' | 'professional-network';
  confidence: 'high' | 'medium' | 'low';
  baseUrl: string;
  displayName: string;
  categories: string[];
}

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
  }
}; 