import { EMPLOYMENT_SOURCES, SourceConfig } from './sourceConfig';

export interface EnhancedCitation {
  domain: string;
  title?: string;
  url?: string;
  type: 'website' | 'inferred';
  sourceType?: string;
  confidence: 'high' | 'medium' | 'low';
  categories?: string[];
  displayName?: string;
  favicon?: string;
}

export const extractDomain = (url: string): string => {
  try {
    // Handle various URL formats
    let cleanUrl = url.trim();
    
    // Add protocol if missing
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }
    
    const urlObj = new URL(cleanUrl);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    // Fallback for malformed URLs - extract domain-like patterns
    const domainMatch = url.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
    return domainMatch ? domainMatch[1] : url;
  }
};

export const getFavicon = (domain: string): string => {
  if (!domain) return '';
  
  // Clean the domain
  const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
  
  // Use a more reliable favicon service with better error handling
  return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${cleanDomain}&size=32`;
};

export const getEmailDomainFavicon = (email: string): string => {
  const domain = email.split('@')[1];
  return domain ? getFavicon(domain) : '';
};

export const getCompetitorFavicon = (competitorName: string): string => {
  if (!competitorName) return '';
  
  // For competitor names, we'll use a more conservative approach
  // Only create domains for simple, short names that are likely to exist
  const cleanName = competitorName.trim().toLowerCase()
    .replace(/\s+/g, '') // Remove spaces
    .replace(/[^a-z0-9-]/g, '') // Remove special characters except hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  
  // Only create domain if we have a valid, reasonably short name
  if (cleanName.length === 0 || cleanName.length > 20) return '';
  
  const domain = `${cleanName}.com`;
  return getFavicon(domain);
};

// Helper to normalize domain names for consistent comparison
const normalizeDomain = (domain: string): string => {
  if (!domain) return '';
  
  // Remove www. prefix and convert to lowercase
  let normalized = domain.toLowerCase().replace(/^www\./, '');
  
  // Handle common variations and country-specific domains
  if (normalized.endsWith('.co.in')) {
    normalized = normalized.replace('.co.in', '.com');
  } else if (normalized.endsWith('.co.uk')) {
    normalized = normalized.replace('.co.uk', '.com');
  } else if (normalized.endsWith('.com.au')) {
    normalized = normalized.replace('.com.au', '.com');
  } else if (normalized.endsWith('.ca')) {
    normalized = normalized.replace('.ca', '.com');
  } else if (normalized.endsWith('.de')) {
    normalized = normalized.replace('.de', '.com');
  } else if (normalized.endsWith('.fr')) {
    normalized = normalized.replace('.fr', '.com');
  }
  
  return normalized;
};

// Map common source names to their canonical domains
const sourceNameToDomain: Record<string, string> = {
  'glassdoor': 'glassdoor.com',
  'indeed': 'indeed.com',
  'comparably': 'comparably.com',
  'medium': 'medium.com',
  'linkedin': 'linkedin.com',
  'jobzmall': 'jobzmall.com',
  'careers': 'careers.com',
  'ziprecruiter': 'ziprecruiter.com',
  'monster': 'monster.com',
  'careerbuilder': 'careerbuilder.com',
  'snagajob': 'snagajob.com',
  'simplyhired': 'simplyhired.com',
  'dice': 'dice.com',
  'angel': 'angel.co',
  'angel.co': 'angel.co',
  'stackoverflow': 'stackoverflow.com',
  'github': 'github.com',
  'crunchbase': 'crunchbase.com',
  'bloomberg': 'bloomberg.com',
  'reuters': 'reuters.com',
  'techcrunch': 'techcrunch.com',
  'wired': 'wired.com',
  'forbes': 'forbes.com',
  'fortune': 'fortune.com',
  'wsj': 'wsj.com',
  'nytimes': 'nytimes.com',
  'cnn': 'cnn.com',
  'bbc': 'bbc.com'
};

export const enhanceCitations = (citations: any[]): EnhancedCitation[] => {
  if (!Array.isArray(citations)) return [];
  
  return citations.map(citation => {
    let domain = '';
    let url = '';
    let title = '';
    
    // Handle different citation formats from different LLMs
    if (typeof citation === 'string') {
      // String citation (URL)
      domain = extractDomain(citation);
      url = citation.startsWith('http') ? citation : '';
    } else if (citation && typeof citation === 'object') {
      // Object citation
      if (citation.domain) {
        // Perplexity format: { domain: "glassdoor.com", url: "..." }
        domain = citation.domain;
        url = citation.url || '';
        title = citation.title || '';
      } else if (citation.source) {
        // Google AI format: { source: "Glassdoor", url: "..." }
        const sourceName = citation.source.toLowerCase().trim();
        
        // Try to map source name to canonical domain
        if (sourceNameToDomain[sourceName]) {
          domain = sourceNameToDomain[sourceName];
        } else if (sourceName.includes('.')) {
          // If source already looks like a domain
          domain = sourceName;
        } else {
          // Try to construct domain from source name
          domain = `${sourceName}.com`;
        }
        
        url = citation.url || '';
        title = citation.title || '';
      } else if (citation.url) {
        // Extract domain from URL if no domain/source field
        domain = extractDomain(citation.url);
        url = citation.url;
        title = citation.title || '';
      }
    }
    
    // Normalize the domain to prevent duplicates
    const normalizedDomain = normalizeDomain(domain);
    
    // Check if it's a known employment source
    const sourceConfig = EMPLOYMENT_SOURCES[normalizedDomain];
    const type: 'website' | 'inferred' = url ? 'website' : 'inferred';
    
    return {
      domain: normalizedDomain,
      title: title || sourceConfig?.displayName,
      url,
      type,
      sourceType: sourceConfig?.type,
      confidence: sourceConfig?.confidence || 'low',
      categories: sourceConfig?.categories,
      displayName: sourceConfig?.displayName,
      favicon: getFavicon(normalizedDomain)
    };
  }).filter(citation => citation.domain); // Remove empty domains
};

export const groupCitationsByDomain = (citations: EnhancedCitation[]): Map<string, EnhancedCitation[]> => {
  const grouped = new Map<string, EnhancedCitation[]>();
  
  citations.forEach(citation => {
    const existing = grouped.get(citation.domain) || [];
    existing.push(citation);
    grouped.set(citation.domain, existing);
  });
  
  return grouped;
};
