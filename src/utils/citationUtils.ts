
export interface EnhancedCitation {
  domain: string;
  title?: string;
  url?: string;
  type: 'website' | 'inferred';
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
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
};

export const enhanceCitations = (citations: any[]): EnhancedCitation[] => {
  if (!Array.isArray(citations)) return [];
  
  return citations.map(citation => {
    let domain = '';
    let url = '';
    let title = '';
    
    // Handle different citation formats
    if (typeof citation === 'string') {
      domain = extractDomain(citation);
      url = citation.startsWith('http') ? citation : '';
    } else if (citation && typeof citation === 'object') {
      domain = citation.domain || (citation.url ? extractDomain(citation.url) : '');
      url = citation.url || '';
      title = citation.title || '';
    }
    
    const type: 'website' | 'inferred' = url ? 'website' : 'inferred';
    
    return {
      domain,
      title,
      url,
      type,
      favicon: getFavicon(domain)
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
