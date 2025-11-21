import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? ''
);

interface CitationWithRecency {
  domain: string;
  title?: string;
  url?: string;
  publicationDate?: string;
  recencyScore: number | null; // null = N/A
  extractionMethod: 'url-pattern' | 'firecrawl-metadata' | 'firecrawl-relative' | 'firecrawl-absolute' | 'not-found' | 'rate-limit-hit' | 'cache-hit' | 'timeout' | 'problematic-domain';
  sourceType?: 'perplexity' | 'google-ai-overviews' | 'bing-copilot' | 'search-results';
}

interface CachedUrl {
  id: string;
  url: string;
  domain: string;
  publication_date: string | null;
  recency_score: number | null;
  extraction_method: string;
  last_checked_at: string;
}

// Cache lookup function with batch processing to avoid URI length limits
async function getCachedUrls(urls: string[]): Promise<Map<string, CachedUrl>> {
  const cacheMap = new Map<string, CachedUrl>();
  
  // Process URLs in batches to avoid URI length limits
  const batchSize = urls.length > 500 ? 25 : 50;
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    
    try {
      const { data, error } = await supabase
        .from('url_recency_cache')
        .select('*')
        .in('url', batch);
      
      if (error) {
        console.error(`Error fetching cached URLs for batch ${Math.floor(i/batchSize) + 1}:`, error);
        continue;
      }
      
      data?.forEach((item: CachedUrl) => {
        cacheMap.set(item.url, item);
      });
      
      console.log(`Processed cache batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urls.length/batchSize)}: ${data?.length || 0} cached URLs found`);
      
    } catch (err) {
      console.error(`Error in cache batch ${Math.floor(i/batchSize) + 1}:`, err);
      continue;
    }
  }
  
  return cacheMap;
}

// Cache storage function
async function storeCachedUrl(citation: CitationWithRecency): Promise<void> {
  if (!citation.url) return;
  
  const cacheData = {
    url: citation.url,
    domain: citation.domain,
    publication_date: citation.publicationDate || null,
    recency_score: citation.recencyScore,
    extraction_method: citation.extractionMethod
  };
  
  const { error } = await supabase
    .from('url_recency_cache')
    .upsert(cacheData, { onConflict: 'url' });
  
  if (error) {
    console.error('Error storing cached URL:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { citations, testMode = false } = await req.json();

    if (!citations || !Array.isArray(citations)) {
      return new Response(
        JSON.stringify({ error: 'citations array is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlApiKey) {
      console.log('FIRECRAWL_API_KEY not found, will use URL pattern matching only');
    }

    const startTime = Date.now();
    const maxProcessingTime = 110000;
    let firecrawlRequestCount = 0;
    let consecutiveFirecrawlErrors = 0;
    let rateLimitHit = false;
    let problematicDomainCount = 0;
    
    console.log(`Starting to process ${citations.length} citations with intelligent caching and deduplication`);
    
    // Step 1: Deduplicate URLs within this batch
    const urlToCitations = new Map<string, typeof citations>();
    const uniqueUrls: string[] = [];
    
    for (const citation of citations) {
      const url = citation.url || citation.link;
      if (url) {
        if (!urlToCitations.has(url)) {
          urlToCitations.set(url, []);
          uniqueUrls.push(url);
        }
        urlToCitations.get(url)!.push(citation);
      }
    }
    
    console.log(`Deduplication: ${citations.length} citations reduced to ${uniqueUrls.length} unique URLs`);
    
    // Step 2: Check cache for unique URLs
    console.log(`Looking up ${uniqueUrls.length} unique URLs in cache`);
    const cachedUrls = await getCachedUrls(uniqueUrls);
    console.log(`Cache lookup complete: Found ${cachedUrls.size} cached URLs`);
    
    // Step 3: Build results map for unique URLs
    const urlResults = new Map<string, CitationWithRecency>();
    const urlsToAnalyze: string[] = [];
    
    for (const url of uniqueUrls) {
      const cached = cachedUrls.get(url);
      if (cached) {
        // Use cached result
        urlResults.set(url, {
          domain: cached.domain,
          url: cached.url,
          publicationDate: cached.publication_date || undefined,
          recencyScore: cached.recency_score,
          extractionMethod: 'cache-hit',
        });
        console.log(`Cache hit: ${cached.domain}`);
      } else {
        // Need to analyze this URL
        urlsToAnalyze.push(url);
      }
    }
    
    console.log(`Cache hits: ${urlResults.size}, URLs to analyze: ${urlsToAnalyze.length}`);
    
    // Step 4: Analyze unique URLs not in cache
    for (let i = 0; i < urlsToAnalyze.length; i++) {
      const url = urlsToAnalyze[i];
      
      // Check timeout
      if (Date.now() - startTime > maxProcessingTime) {
        console.log(`Timeout approaching after processing ${i} URLs, stopping`);
        break;
      }
      
      // Get first citation for this URL to extract metadata
      const citationsForUrl = urlToCitations.get(url) || [];
      const firstCitation = citationsForUrl[0];
      
      // Skip Firecrawl if necessary
      const skipFirecrawl = rateLimitHit || consecutiveFirecrawlErrors >= 3 || (urlsToAnalyze.length > 200 && firecrawlRequestCount > 50);
      
      const result = await extractRecencyScore(firstCitation, firecrawlApiKey, testMode, skipFirecrawl);
      urlResults.set(url, result);
      
      // Track problematic domains
      if (result.extractionMethod === 'problematic-domain') {
        problematicDomainCount++;
      }
      
      // Store in cache
      if (result.extractionMethod !== 'rate-limit-hit') {
        await storeCachedUrl(result);
      }
      
      // Track Firecrawl usage
      if (!skipFirecrawl && !testMode && firecrawlApiKey) {
        if (result.extractionMethod === 'firecrawl-metadata' || result.extractionMethod === 'firecrawl-relative' || result.extractionMethod === 'firecrawl-absolute') {
          firecrawlRequestCount++;
          consecutiveFirecrawlErrors = 0;
        } else if (result.extractionMethod === 'not-found') {
          const isTimeout = result.publicationDate === undefined;
          if (!isTimeout) {
            consecutiveFirecrawlErrors++;
            if (consecutiveFirecrawlErrors >= 5) {
              console.log(`Too many consecutive Firecrawl failures (${consecutiveFirecrawlErrors}), switching to URL patterns only`);
            }
          }
        } else if (result.extractionMethod === 'rate-limit-hit') {
          rateLimitHit = true;
          console.log('Rate limit detected, switching to URL patterns only');
        }
      }
      
      console.log(`[${i + 1}/${urlsToAnalyze.length}] ${result.domain} - ${result.extractionMethod} (Firecrawl: ${firecrawlRequestCount})`);
      
      // Add delay
      if (!testMode && i < urlsToAnalyze.length - 1) {
        const baseDelay = urlsToAnalyze.length > 100 ? 500 : urlsToAnalyze.length > 50 ? 750 : 1000;
        const delay = result.extractionMethod === 'problematic-domain' ? Math.min(200, baseDelay) : baseDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Step 5: Map results back to all citations (including duplicates)
    const results: CitationWithRecency[] = [];
    
    for (const citation of citations) {
      const url = citation.url || citation.link;
      
      if (!url) {
        results.push({
          domain: citation.domain || 'unknown',
          title: citation.title,
          url: undefined,
          recencyScore: null,
          extractionMethod: 'not-found',
          sourceType: citation.sourceType
        });
        continue;
      }
      
      const urlResult = urlResults.get(url);
      if (urlResult) {
        // Add citation-specific fields back
        results.push({
          ...urlResult,
          title: citation.title,
          sourceType: citation.sourceType
        });
      } else {
        // URL wasn't processed (timeout)
        results.push({
          domain: citation.domain || extractDomainFromUrl(url),
          title: citation.title,
          url: url,
          recencyScore: null,
          extractionMethod: 'timeout',
          sourceType: citation.sourceType
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        summary: {
          total: results.length,
          uniqueUrls: uniqueUrls.length,
          duplicatesAvoided: citations.length - uniqueUrls.length,
          withDates: results.filter(r => r.recencyScore !== null).length,
          withoutDates: results.filter(r => r.recencyScore === null).length,
          cacheHits: results.filter(r => r.extractionMethod === 'cache-hit').length,
          newlyAnalyzed: urlsToAnalyze.length,
          firecrawlRequestsMade: firecrawlRequestCount,
          problematicDomainsSkipped: problematicDomainCount
        }
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Error extracting recency scores:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to extract recency scores' }),
      { status: 500, headers: corsHeaders }
    );
  }
});

async function extractRecencyScore(
  citation: any, 
  firecrawlApiKey: string | undefined, 
  testMode: boolean,
  skipFirecrawl: boolean = false
): Promise<CitationWithRecency> {
  const url = citation.url || citation.link;
  
  if (!url) {
    return {
      domain: citation.domain || 'unknown',
      title: citation.title,
      url: undefined,
      recencyScore: null,
      extractionMethod: 'not-found',
      sourceType: citation.sourceType
    };
  }

  // Method 1: Try URL pattern matching first (fastest, most reliable)
  const urlDate = extractDateFromUrl(url);
  if (urlDate) {
    return {
      domain: citation.domain || extractDomainFromUrl(url),
      title: citation.title,
      url: url,
      publicationDate: urlDate,
      recencyScore: calculateRecencyScore(urlDate),
      extractionMethod: 'url-pattern',
      sourceType: citation.sourceType
    };
  }

  // Check if this is a problematic domain that we should skip Firecrawl for
  if (isProblematicDomain(url)) {
    console.log(`Skipping Firecrawl for problematic domain: ${extractDomainFromUrl(url)}`);
    return {
      domain: citation.domain || extractDomainFromUrl(url),
      title: citation.title,
      url: url,
      recencyScore: null,
      extractionMethod: 'problematic-domain',
      sourceType: citation.sourceType
    };
  }

  // Method 2: Try Firecrawl scraping with metadata + markdown (if not skipped, not in test mode and API key available)
  if (!testMode && firecrawlApiKey && !skipFirecrawl) {
    try {
      const firecrawlDate = await extractDateWithFirecrawl(url, firecrawlApiKey);
      if (firecrawlDate.date) {
        return {
          domain: citation.domain || extractDomainFromUrl(url),
          title: citation.title,
          url: url,
          publicationDate: firecrawlDate.date,
          recencyScore: calculateRecencyScore(firecrawlDate.date),
          extractionMethod: firecrawlDate.method,
          sourceType: citation.sourceType
        };
      }
    } catch (error) {
      console.log(`Firecrawl extraction failed for ${url}:`, error);
      // Check if it's a rate limit error
      if (error.message?.includes('429')) {
        return {
          domain: citation.domain || extractDomainFromUrl(url),
          title: citation.title,
          url: url,
          recencyScore: null,
          extractionMethod: 'rate-limit-hit',
          sourceType: citation.sourceType
        };
      }
    }
  }

  // No date found - return N/A
  return {
    domain: citation.domain || extractDomainFromUrl(url),
    title: citation.title,
    url: url,
    recencyScore: null,
    extractionMethod: 'not-found',
    sourceType: citation.sourceType
  };
}

function extractDateFromUrl(url: string): string | null {
  // Helper to validate year is reasonable (web content dates)
  const isValidYear = (year: string): boolean => {
    const yearNum = parseInt(year, 10);
    return yearNum >= 1990 && yearNum <= 2050; // Reasonable range for web content
  };

  const patterns = [
    // YYYY/MM/DD or YYYY-MM-DD
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    // YYYY/MM or YYYY-MM
    /(\d{4})[\/\-](\d{1,2})(?:\/|$)/,
    // YYYY
    /(\d{4})(?:\/|$)/,
    // Month DD, YYYY (full month names)
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
    // Month DD, YYYY (abbreviated month names)
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})/i
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      if (pattern === patterns[0]) { // YYYY/MM/DD or YYYY-MM-DD
        const [, year, month, day] = match;
        if (!isValidYear(year)) continue;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else if (pattern === patterns[1]) { // YYYY/MM or YYYY-MM
        const [, year, month] = match;
        if (!isValidYear(year)) continue;
        return `${year}-${month.padStart(2, '0')}-01`;
      } else if (pattern === patterns[2]) { // YYYY
        const [, year] = match;
        if (!isValidYear(year)) continue;
        return `${year}-01-01`;
      } else if (pattern === patterns[3]) { // Month DD, YYYY (full month names)
        const [, month, day, year] = match;
        if (!isValidYear(year)) continue;
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else if (pattern === patterns[4]) { // Month DD, YYYY (abbreviated month names)
        const [, month, day, year] = match;
        if (!isValidYear(year)) continue;
        const monthNum = getMonthNumber(month);
        if (monthNum) {
          return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
      }
    }
  }
  
  return null;
}

// Parse relative dates like "1 yr ago", "yesterday", etc.
// Parse Reddit-specific date format: • 2y ago, • 6mo ago, etc.
function parseRedditDate(text: string): string | null {
  // Look for Reddit timestamp pattern: • 2y ago, • 6mo ago, etc.
  const redditPattern = /•\s*(\d+)(y|mo|d|h|m)\s*ago/i;
  const match = text.match(redditPattern);
  
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    const now = new Date();
    let targetDate = new Date(now);
    
    switch (unit) {
      case 'y': 
        targetDate.setFullYear(now.getFullYear() - value); 
        break;
      case 'mo': 
        targetDate.setMonth(now.getMonth() - value); 
        break;
      case 'd': 
        targetDate.setDate(now.getDate() - value); 
        break;
      case 'h': 
        targetDate.setHours(now.getHours() - value); 
        break;
      case 'm': 
        targetDate.setMinutes(now.getMinutes() - value); 
        break;
    }
    
    return targetDate.toISOString().split('T')[0];
  }
  
  return null;
}

function parseRelativeDate(text: string): string | null {
  const now = new Date();
  
  // "1 yr ago", "2 years ago"
  let match = text.match(/(\d+)\s*(?:yr|year)s?\s*ago/i);
  if (match) {
    const years = parseInt(match[1], 10);
    const date = new Date(now);
    date.setFullYear(date.getFullYear() - years);
    return date.toISOString().split('T')[0];
  }
  
  // "8mo ago", "3 months ago"
  match = text.match(/(\d+)\s*(?:mo|month)s?\s*ago/i);
  if (match) {
    const months = parseInt(match[1], 10);
    const date = new Date(now);
    date.setMonth(date.getMonth() - months);
    return date.toISOString().split('T')[0];
  }
  
  // "5d ago", "10 days ago"
  match = text.match(/(\d+)\s*(?:d|day)s?\s*ago/i);
  if (match) {
    const days = parseInt(match[1], 10);
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }
  
  // "2w ago", "3 weeks ago"
  match = text.match(/(\d+)\s*(?:w|week)s?\s*ago/i);
  if (match) {
    const weeks = parseInt(match[1], 10);
    const date = new Date(now);
    date.setDate(date.getDate() - (weeks * 7));
    return date.toISOString().split('T')[0];
  }
  
  // "yesterday"
  if (/yesterday/i.test(text)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  }
  
  // "today"
  if (/today/i.test(text)) {
    return now.toISOString().split('T')[0];
  }
  
  return null;
}

async function extractDateWithFirecrawl(url: string, apiKey: string): Promise<{ date: string | null; method: 'firecrawl-metadata' | 'firecrawl-relative' | 'firecrawl-absolute' | 'firecrawl-reddit' }> {
  try {
    // Single scrape with markdown format (1 credit)
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown'], // Only markdown, NOT json (saves 4 credits!)
        onlyMainContent: true,
        timeout: 30000
      })
    });

    if (!response.ok) {
      if (response.status === 408) {
        console.log(`Firecrawl timeout (408) for ${url}`);
        return { date: null, method: 'firecrawl-metadata' };
      }
      if (response.status === 429) {
        console.log(`Firecrawl rate limit (429) for ${url}`);
        throw new Error('429');
      }
      console.log(`Firecrawl API error: ${response.status} for ${url}`);
      return { date: null, method: 'firecrawl-metadata' };
    }

    const data = await response.json();
    
    // STEP 1: Check metadata (comes FREE with every scrape!)
    if (data.data?.metadata) {
      const metadata = data.data.metadata;
      
      // Try common metadata fields
      const dateFields = [
        metadata.publishedTime,
        metadata.modifiedTime,
        metadata.ogPublishedTime,
        metadata['article:published_time'],
        metadata.datePublished,
        metadata['og:published_time']
      ];
      
      for (const field of dateFields) {
        if (field) {
          try {
            const date = new Date(field);
            if (!isNaN(date.getTime())) {
              console.log(`Found date in metadata: ${field}`);
              return { date: date.toISOString().split('T')[0], method: 'firecrawl-metadata' };
            }
          } catch (e) {
            continue;
          }
        }
      }
    }
    
    const markdown = data.data?.markdown;
    if (!markdown) return { date: null, method: 'firecrawl-metadata' };

    // STEP 2: Try Reddit-specific date patterns first (more reliable for Reddit)
    const redditDate = parseRedditDate(markdown);
    if (redditDate) {
      console.log(`Found Reddit date in markdown: ${redditDate}`);
      return { date: redditDate, method: 'firecrawl-reddit' };
    }

    // STEP 3: Try relative date patterns (e.g., "1 yr ago", "yesterday")
    const relativeDate = parseRelativeDate(markdown);
    if (relativeDate) {
      console.log(`Found relative date in markdown: ${relativeDate}`);
      return { date: relativeDate, method: 'firecrawl-relative' };
    }

    // STEP 3: Look for absolute date patterns in markdown
    const datePatterns = [
      // Month DD, YYYY (e.g., "Mar 14, 2022")
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})/i,
      // Full month DD, YYYY (e.g., "March 14, 2022")
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
      // YYYY-MM-DD
      /(\d{4})-(\d{1,2})-(\d{1,2})/,
      // MM/DD/YYYY
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/
    ];

    for (const pattern of datePatterns) {
      const match = markdown.match(pattern);
      if (match) {
        let dateStr = '';
        
        if (pattern === datePatterns[0] || pattern === datePatterns[1]) { // Month DD, YYYY
          const [, month, day, year] = match;
          const monthNum = getMonthNumber(month);
          if (monthNum) {
            dateStr = `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
        } else if (pattern === datePatterns[2]) { // YYYY-MM-DD
          const [, year, month, day] = match;
          dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        } else if (pattern === datePatterns[3]) { // MM/DD/YYYY
          const [, month, day, year] = match;
          dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        if (dateStr) {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            console.log(`Found absolute date in markdown: ${dateStr}`);
            return { date: date.toISOString().split('T')[0], method: 'firecrawl-absolute' };
          }
        }
      }
    }

    return { date: null, method: 'firecrawl-absolute' };
  } catch (error) {
    console.error('Firecrawl extraction error:', error);
    if (error.message === '429') {
      throw error;
    }
    return { date: null, method: 'firecrawl-metadata' };
  }
}

function calculateRecencyScore(dateString: string): number {
  const publicationDate = new Date(dateString);
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - publicationDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffInDays < 0) return 100; // Future date
  if (diffInDays <= 30) return 100; // Last month
  if (diffInDays <= 90) return 90;  // Last 3 months
  if (diffInDays <= 180) return 80; // Last 6 months
  if (diffInDays <= 365) return 70; // Last year
  if (diffInDays <= 730) return 50; // Last 2 years
  if (diffInDays <= 1095) return 30; // Last 3 years
  if (diffInDays <= 1825) return 20; // Last 5 years
  if (diffInDays <= 3650) return 10; // Last 10 years
  return 0; // Older than 10 years
}

function getMonthNumber(month: string): number | null {
  const months = {
    'jan': 1, 'january': 1,
    'feb': 2, 'february': 2,
    'mar': 3, 'march': 3,
    'apr': 4, 'april': 4,
    'may': 5,
    'jun': 6, 'june': 6,
    'jul': 7, 'july': 7,
    'aug': 8, 'august': 8,
    'sep': 9, 'september': 9,
    'oct': 10, 'october': 10,
    'nov': 11, 'november': 11,
    'dec': 12, 'december': 12
  };
  return months[month.toLowerCase()] || null;
}

function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

// Domains known to be problematic for scraping (slow, anti-bot measures, etc.)
function isProblematicDomain(url: string): boolean {
  const domain = extractDomainFromUrl(url).toLowerCase();
  const problematicDomains = [
    'glassdoor.com',
    'www.glassdoor.com', 
    'glassdoor.co.uk',
    'glassdoor.ie',
    'indeed.com',
    'www.indeed.com',
    'in.indeed.com',
    'linkedin.com',
    'www.linkedin.com',
    'facebook.com',
    'www.facebook.com',
    'twitter.com',
    'x.com',
    // Removed reddit.com - Reddit has consistent date format that can be parsed
    'yelp.com',
    'www.yelp.com',
    'comparably.com',
    'www.comparably.com',
    'greatplacetowork.com',
    'www.greatplacetowork.com',
    'teamblind.com',
    'www.teamblind.com',
    'ambitionbox.com',
    'www.ambitionbox.com',
    'ziprecruiter.com',
    'www.ziprecruiter.com'
  ];
  
  return problematicDomains.some(problematic => domain.includes(problematic));
}
