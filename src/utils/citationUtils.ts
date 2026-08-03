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

// ---------------------------------------------------------------------------
// Google redirect / wrapper URLs
//
// Google's SERP payloads point many cited links at google.com rather than at
// the source itself:
//   translate.google.com/translate?u=<real>&hl=es   (localized markets)
//   www.google.com/url?sa=i&...&url=<real>&ved=...  (image / result redirect)
//   www.google.com/imgres?imgurl=<img>&imgrefurl=<real>
//
// The collection pipeline now unwraps these before storing
// (supabase/functions/_shared/citation-extraction.ts — keep the two in sync),
// but historical rows still hold wrappers, so the dashboard unwraps on read
// too. Wrappers with no recoverable target are Google UI surfaces, not
// sources: isUsableCitationUrl rejects them so they don't show as google.com.
// ---------------------------------------------------------------------------

/** true for google.com, www.google.co.uk, translate.google.com … but not notgoogle.com */
const isGoogleHost = (hostname: string): boolean =>
  /(^|\.)google\.[a-z.]{2,}$/i.test(hostname);

/** Query params carrying the real destination, by wrapper type, in priority order. */
const redirectParamsFor = (hostname: string, pathname: string): string[] => {
  if (/^translate\.google/i.test(hostname) || /^translate\.googleusercontent/i.test(hostname)) {
    return ['u'];
  }
  if (!isGoogleHost(hostname)) return [];
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/url') return ['url', 'q'];
  if (path === '/imgres') return ['imgrefurl', 'imgurl'];
  return [];
};

const unwrapOnce = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const param of redirectParamsFor(parsed.hostname, parsed.pathname)) {
    // URL.searchParams.get already decodes percent-encoding.
    const target = parsed.searchParams.get(param);
    if (target && /^https?:\/\//i.test(target)) {
      return target.split('#:~:text=')[0];
    }
  }
  return url;
};

// Google-hosted paths that are search-UI surfaces rather than sources.
const GOOGLE_UI_PATHS = /^\/(url|imgres|search|searchviewer|viewer|async|sorry|preferences|setprefs)(\/|$)/i;

/**
 * Whether a (already unwrapped) URL is worth showing as a citation.
 * Rejects leftover Google redirect wrappers and search-UI pages, so a wrapper
 * we couldn't unwrap never surfaces as a google.com source.
 */
export const isUsableCitationUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (isGoogleHost(parsed.hostname) && GOOGLE_UI_PATHS.test(parsed.pathname)) return false;
  return true;
};

/**
 * Extracts the actual source URL from a Google redirect wrapper
 * (translate.google.com `u=`, google.com/url `url=`/`q=`, google.com/imgres,
 * on any google ccTLD).
 * Strips the #:~:text= highlight fragment Google appends. Wrappers can nest,
 * so unwrapping repeats until the URL stops changing.
 * Returns the original URL when it isn't a wrapper.
 */
export const extractSourceUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;

  let current = url.trim();
  // Bounded: a wrapper chain longer than this is pathological, not real data.
  for (let i = 0; i < 3; i++) {
    const next = unwrapOnce(current);
    if (next === current) break;
    current = next;
  }
  if (current !== url.trim()) return current;

  // Malformed enough that URL() couldn't parse it, but still recognisably a
  // Google wrapper — pull the target param out textually.
  if (/(?:\/\/|\.)google\.[a-z.]+\/(?:url|imgres|translate)/i.test(current)) {
    const paramMatch = current.match(/[?&](?:u|url|q|imgrefurl)=(https?[^&]+)/i);
    if (paramMatch) {
      try {
        return decodeURIComponent(paramMatch[1]).split('#:~:text=')[0];
      } catch {
        return paramMatch[1];
      }
    }
  }

  return current;
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

// Logo.dev publishable token (safe to expose client-side; see https://docs.logo.dev).
const LOGODEV_TOKEN = import.meta.env.VITE_LOGO_DEV_TOKEN as string | undefined;

/**
 * Builds a Logo.dev image URL for a domain.
 *
 * We use Logo.dev instead of Google's favicon service because Google's
 * faviconV2/gstatic endpoints return 404s for many domains, which spam the
 * browser console. Logo.dev's `fallback=monogram` guarantees an image is
 * always returned (a generated letter-mark), so it never 404s.
 */
export const getFavicon = (domain: string, size = 32): string => {
  if (!domain) return '';

  // Clean the domain
  const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');

  const params = new URLSearchParams({
    size: String(size),
    format: 'png',
    fallback: 'monogram',
  });
  if (LOGODEV_TOKEN) params.set('token', LOGODEV_TOKEN);

  return `https://img.logo.dev/${cleanDomain}?${params.toString()}`;
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
  // A Google redirect wrapper we couldn't unwrap has no source behind it —
  // counting it would attribute the citation to google.com.
  if (url && !isUsableCitationUrl(url)) return null;

  // Historical rows stored the wrapper's domain ("google.com") alongside the
  // wrapper URL. Once the URL is unwrapped that domain is wrong, so re-derive
  // it from the real target.
  const rawUrl = typeof citation === 'string' ? citation : citation?.url;
  if (url && typeof rawUrl === 'string' && rawUrl.trim() !== url) {
    domain = extractDomain(url);
  }

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

// Hosts whose page identity lives in a query parameter rather than the path.
// youtube.com/watch?v=ID is the canonical case: the path is always "/watch",
// so stripping the whole query string collapses every video into one page.
// For these hosts the listed params are kept in the grouping key; all other
// params (t=, si=, feature=, utm_*) are still dropped so timestamp/tracking
// variants of the same video keep collapsing together.
const IDENTITY_QUERY_PARAMS: Record<string, string[]> = {
  'youtube.com': ['v', 'list'],
  'music.youtube.com': ['v', 'list'],
};

// Normalizes a URL for grouping: domain + path (no query/hash, lowercased, trims trailing slash, no www, no protocol).
// For IDENTITY_QUERY_PARAMS hosts, the identity params are appended in a fixed
// order (param values keep their case — YouTube video IDs are case-sensitive).
export function normalizePageKey(urlLike: string): string {
  try {
    // Extract actual source URL if it's a Google Translate URL
    let clean = extractSourceUrl(urlLike.trim());
    if (!/^https?:\/\//.test(clean)) clean = 'https://' + clean;
    const u = new URL(clean);
    let host = u.hostname.replace(/^www\./, '').toLowerCase();
    // Mobile YouTube serves the same pages as desktop.
    if (host === 'm.youtube.com') host = 'youtube.com';
    const path = u.pathname.replace(/\/$/, '');

    // youtu.be/<id> short links are the same page as the full watch URL.
    if (host === 'youtu.be') {
      const id = path.split('/')[1];
      if (id) return `youtube.com/watch?v=${id}`;
    }

    const identityParams = IDENTITY_QUERY_PARAMS[host];
    if (identityParams) {
      const kept = identityParams
        .filter((p) => u.searchParams.get(p))
        .map((p) => `${p}=${u.searchParams.get(p)}`);
      if (kept.length > 0) return `${host}${path.toLowerCase()}?${kept.join('&')}`;
    }

    return `${host}${path.toLowerCase()}`;
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

  const processOneUrl = (rawUrl: string, title: string, snippet: string, domainFromCitation: string | undefined) => {
    const url = extractSourceUrl(rawUrl);
    if (!url || !url.startsWith('http')) return;
    // Skip un-unwrappable Google redirect wrappers / search-UI pages.
    if (!isUsableCitationUrl(url)) return;
    const pageKey = normalizePageKey(url);
    // A citation whose URL was a redirect wrapper carries the wrapper's domain
    // ("google.com") — re-derive from the real target.
    let domain = typeof rawUrl === 'string' && rawUrl.trim() !== url ? undefined : domainFromCitation;
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
