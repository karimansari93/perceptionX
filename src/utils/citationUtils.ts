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

/**
 * Extracts the actual source URL from Google Translate URLs.
 * If the URL is a Google Translate URL, extracts the 'u' parameter value.
 * Otherwise, returns the original URL.
 */
export const extractSourceUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  
  try {
    const urlObj = new URL(url.trim());
    
    // Check if this is a Google Translate URL
    if (urlObj.hostname.includes('translate.google') || 
        urlObj.hostname.includes('translate.googleusercontent')) {
      // Extract the 'u' parameter which contains the actual source URL
      const sourceUrl = urlObj.searchParams.get('u');
      if (sourceUrl) {
        // Decode the URL if it's encoded
        try {
          return decodeURIComponent(sourceUrl);
        } catch {
          return sourceUrl;
        }
      }
    }
    
    // Not a Google Translate URL, return original
    return url.trim();
  } catch {
    // If URL parsing fails, try to extract 'u' parameter manually
    const uParamMatch = url.match(/[?&]u=([^&]+)/);
    if (uParamMatch) {
      try {
        return decodeURIComponent(uParamMatch[1]);
      } catch {
        return uParamMatch[1];
      }
    }
    
    // Return original URL if we can't parse it
    return url.trim();
  }
};

export const extractDomain = (url: string): string => {
  try {
    // First extract the actual source URL if it's a Google Translate URL
    const sourceUrl = extractSourceUrl(url);
    
    // Handle various URL formats
    let cleanUrl = sourceUrl.trim();
    
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
  return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`;
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

// Treat domain as missing when it's empty or the literal "unknown" (e.g. from ChatGPT citations)
const isDomainMissing = (domain: string): boolean => {
  if (!domain || typeof domain !== 'string') return true;
  const d = domain.trim().toLowerCase();
  return d === '' || d === 'unknown';
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
  'bbc': 'bbc.com',
  'great place to work': 'greatplacetowork.com',
  'built in': 'builtin.com'
};

/** Build one EnhancedCitation for a given domain/url/title and shared citation fields. */
const buildEnhancedCitation = (
  domain: string,
  url: string,
  title: string,
  citation: any
): EnhancedCitation | null => {
  if (isDomainMissing(domain)) {
    // Derive domain from URL when missing or "unknown" (e.g. ChatGPT citations)
    if (url) {
      domain = extractDomain(url);
    }
  }
  if (!domain || isDomainMissing(domain)) return null;

  const normalizedDomain = normalizeDomain(domain);
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
};

export const enhanceCitations = (citations: any[]): EnhancedCitation[] => {
  if (!Array.isArray(citations)) return [];

  const out: EnhancedCitation[] = [];

  for (const citation of citations) {
    let domain = '';
    let url = '';
    let title = '';

    if (typeof citation === 'string') {
      url = extractSourceUrl(citation);
      domain = extractDomain(url);
      url = url.startsWith('http') ? url : '';
      const built = buildEnhancedCitation(domain, url, title, citation);
      if (built) out.push(built);
      continue;
    }

    if (!citation || typeof citation !== 'object') continue;

    // ChatGPT-style: multiple URLs in one citation (no or "unknown" domain)
    const urlsArray = citation.urls && Array.isArray(citation.urls) ? citation.urls : null;
    if (urlsArray && urlsArray.length > 0) {
      const sharedTitle = citation.title || '';
      for (const rawUrl of urlsArray) {
        const u = typeof rawUrl === 'string' ? extractSourceUrl(rawUrl) : '';
        if (!u || !u.startsWith('http')) continue;
        const d = extractDomain(u);
        if (!d) continue;
        const built = buildEnhancedCitation(d, u, sharedTitle, citation);
        if (built) out.push(built);
      }
      continue;
    }

    // Single-URL object citation
    if (citation.domain && !isDomainMissing(citation.domain)) {
      domain = citation.domain;
      url = citation.url ? extractSourceUrl(citation.url) : '';
      title = citation.title || '';
    } else if (citation.source) {
      const sourceName = citation.source.toLowerCase().trim();
      url = citation.url ? extractSourceUrl(citation.url) : '';
      title = citation.title || '';
      if (url) {
        const extractedDomain = extractDomain(url);
        if (extractedDomain && extractedDomain !== url) domain = extractedDomain;
      }
      if (!domain) {
        if (sourceNameToDomain[sourceName]) domain = sourceNameToDomain[sourceName];
        else if (sourceName.includes('.')) domain = sourceName;
        else {
          const cleanSourceName = sourceName
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/, '');
          if (cleanSourceName) domain = `${cleanSourceName}.com`;
        }
      }
    } else if (citation.url) {
      url = extractSourceUrl(citation.url);
      domain = extractDomain(url);
      title = citation.title || '';
    } else {
      continue;
    }

    // If domain is still "unknown" or empty but we have a URL, derive from URL
    if (isDomainMissing(domain) && url) domain = extractDomain(url);

    const built = buildEnhancedCitation(domain, url, title, citation);
    if (built) out.push(built);
  }

  return out.filter(c => c.domain && !isDomainMissing(c.domain));
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

// Normalizes a URL for grouping: domain + path (no query/hash, lowercased, trims trailing slash, no www, no protocol)
export function normalizePageKey(urlLike: string): string {
  try {
    // Extract actual source URL if it's a Google Translate URL
    let clean = extractSourceUrl(urlLike.trim());
    if (!/^https?:\/\//.test(clean)) clean = 'https://' + clean;
    const u = new URL(clean);
    let host = u.hostname.replace(/^www\./, '').toLowerCase();
    let path = u.pathname.replace(/\/$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    // Fallback if not valid URL
    return urlLike.trim().toLowerCase();
  }
}

/**
 * Aggregate most mentioned unique pages by normalized domain+path, not strict URL.
 * @param rawCitations (flat array)
 * @returns Array: [{title, url, domain, mentionCount, snippet?}]
 */
export function getMostMentionedPages(rawCitations: any[], max?: number) {
  // Map of pageKey => array of {title, url, domain, snippet, mentionCount}
  const pageMap = new Map<string, {titles: {[t:string]:number}, urls: string[], domain?: string, snippets: {[s:string]:number}, mentionCount: number}>();

  const processOneUrl = (url: string, title: string, snippet: string, domainFromCitation: string | undefined) => {
    url = extractSourceUrl(url);
    if (!url || !url.startsWith('http')) return;
    const pageKey = normalizePageKey(url);
    let domain = domainFromCitation;
    if (!domain || (typeof domain === 'string' && domain.trim().toLowerCase() === 'unknown')) {
      domain = extractDomain(url);
    }
    if (!pageMap.has(pageKey)) {
      pageMap.set(pageKey, {titles: {}, urls: [url], domain, snippets: {}, mentionCount: 1});
      if (title) pageMap.get(pageKey)!.titles[title] = 1;
      if (snippet) pageMap.get(pageKey)!.snippets[snippet] = 1;
    } else {
      const p = pageMap.get(pageKey)!;
      p.urls.push(url);
      p.mentionCount++;
      if (title) p.titles[title] = (p.titles[title] || 0) + 1;
      if (snippet) p.snippets[snippet] = (p.snippets[snippet] || 0) + 1;
    }
  };

  for (const citation of rawCitations) {
    const title = citation.title || '';
    const snippet = citation.snippet || '';
    const domainFromCitation = citation.domain || (citation.source && typeof citation.source === 'string' ? citation.source : undefined);

    const singleUrl = citation?.url || citation?.link;
    if (singleUrl) {
      processOneUrl(singleUrl, title, snippet, domainFromCitation);
    }
    // ChatGPT-style: multiple URLs in one citation
    if (citation.urls && Array.isArray(citation.urls)) {
      for (const rawUrl of citation.urls) {
        const u = typeof rawUrl === 'string' ? rawUrl : '';
        if (u) processOneUrl(u, title, snippet, domainFromCitation);
      }
    }
  }

  // Convert to final output array
  let arr = Array.from(pageMap.entries()).map(([key, val]) => {
    // Most common title/snippet
    const bestTitle = Object.entries(val.titles).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const bestSnippet = Object.entries(val.snippets).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return {
      title: bestTitle,
      url: val.urls[0],
      domain: val.domain,
      snippet: bestSnippet,
      mentionCount: val.mentionCount
    }
  }).sort((a, b) => b.mentionCount - a.mentionCount);

  if (max && arr.length > max) arr = arr.slice(0, max);
  return arr;
}
