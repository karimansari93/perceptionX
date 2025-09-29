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
  extractionMethod: 'url-pattern' | 'firecrawl-json' | 'firecrawl-html' | 'not-found' | 'rate-limit-hit' | 'cache-hit' | 'timeout' | 'problematic-domain';
  sourceType?: 'perplexity' | 'google-ai-overviews' | 'search-results';
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
  // Use smaller batches for very large datasets to be extra safe
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
        continue; // Continue with next batch
      }
      
      data?.forEach((item: CachedUrl) => {
        cacheMap.set(item.url, item);
      });
      
      console.log(`Processed cache batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(urls.length/batchSize)}: ${data?.length || 0} cached URLs found`);
      
    } catch (err) {
      console.error(`Error in cache batch ${Math.floor(i/batchSize) + 1}:`, err);
      continue; // Continue with next batch
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

    const results: CitationWithRecency[] = [];
    const startTime = Date.now();
    const maxProcessingTime = 110000; // 110 seconds max (optimized for unlimited citations)
    let firecrawlRequestCount = 0;
    let consecutiveFirecrawlErrors = 0;
    let rateLimitHit = false;
    let problematicDomainCount = 0;
    
    console.log(`Starting to process ${citations.length} citations (NO LIMIT - processing ALL URLs with intelligent caching)`);
    
    // Step 1: Extract all URLs and check cache
    const citationUrls = citations
      .map(c => c.url || c.link)
      .filter((url): url is string => !!url);
    
    console.log(`Looking up ${citationUrls.length} URLs in cache (using batched queries to avoid URI limits)`);
    const cachedUrls = await getCachedUrls(citationUrls);
    console.log(`Cache lookup complete: Found ${cachedUrls.size} cached URLs out of ${citationUrls.length} total`);
    
    // Step 2: Process citations - use cache when available, analyze when not
    const urlsToAnalyze: typeof citations = [];
    
    for (const citation of citations) {
      const url = citation.url || citation.link;
      
      if (!url) {
        // No URL - return not-found result
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
      
      const cached = cachedUrls.get(url);
      if (cached) {
        // Use cached result
        results.push({
          domain: cached.domain,
          title: citation.title,
          url: cached.url,
          publicationDate: cached.publication_date || undefined,
          recencyScore: cached.recency_score,
          extractionMethod: 'cache-hit',
          sourceType: citation.sourceType
        });
        console.log(`Cache hit: ${cached.domain} - ${cached.extraction_method}`);
      } else {
        // Need to analyze this URL
        urlsToAnalyze.push(citation);
      }
    }
    
    console.log(`Cache hits: ${results.length}, URLs to analyze: ${urlsToAnalyze.length}`);
    
    // Step 3: Analyze URLs not in cache
    for (let i = 0; i < urlsToAnalyze.length; i++) {
      const citation = urlsToAnalyze[i];
      
      // Check if we're running out of time
      if (Date.now() - startTime > maxProcessingTime) {
        console.log(`Timeout approaching after processing ${i} new citations, stopping`);
        break;
      }
      
      // Skip Firecrawl if we've hit rate limits, too many consecutive errors, or processing very large batch
      const skipFirecrawl = rateLimitHit || consecutiveFirecrawlErrors >= 3 || (urlsToAnalyze.length > 200 && firecrawlRequestCount > 50);
      
      const result = await extractRecencyScore(citation, firecrawlApiKey, testMode, skipFirecrawl);
      results.push(result);
      
      // Track problematic domains
      if (result.extractionMethod === 'problematic-domain') {
        problematicDomainCount++;
      }
      
      // Store result in cache (only if we actually analyzed it)
      if (result.extractionMethod !== 'rate-limit-hit') {
        await storeCachedUrl(result);
      }
      
      // Track Firecrawl usage and errors
      if (!skipFirecrawl && !testMode && firecrawlApiKey) {
        if (result.extractionMethod === 'firecrawl-json' || result.extractionMethod === 'firecrawl-html') {
          firecrawlRequestCount++;
          consecutiveFirecrawlErrors = 0; // Reset error count on success
        } else if (result.extractionMethod === 'not-found') {
          // Only count as error if it's not a timeout (timeouts are expected for slow sites)
          const isTimeout = result.publicationDate === undefined; // Timeout results don't set publicationDate
          if (!isTimeout) {
            consecutiveFirecrawlErrors++;
            if (consecutiveFirecrawlErrors >= 5) { // Increased threshold since timeouts don't count
              console.log(`Too many consecutive Firecrawl failures (${consecutiveFirecrawlErrors}), switching to URL patterns only`);
            }
          }
        } else if (result.extractionMethod === 'rate-limit-hit') {
          rateLimitHit = true;
          console.log('Rate limit detected, switching to URL patterns only for all remaining citations');
        }
      }
      
      console.log(`Analyzed citation ${i + 1}/${urlsToAnalyze.length}: ${result.domain} - ${result.extractionMethod} (Firecrawl requests: ${firecrawlRequestCount})`);
      
      // Add delay to avoid rate limits (but shorter for problematic domains since we skip them)
      if (!testMode && i < urlsToAnalyze.length - 1) {
        // Dynamic delay: faster for large batches, slower for small batches to respect rate limits
        // Even faster for problematic domains since we skip Firecrawl entirely
        const baseDelay = urlsToAnalyze.length > 100 ? 500 : urlsToAnalyze.length > 50 ? 750 : 1000;
        const delay = result.extractionMethod === 'problematic-domain' ? Math.min(200, baseDelay) : baseDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        summary: {
          total: results.length,
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
    console.log(`Skipping Firecrawl for problematic domain: ${extractDomainFromUrl(url)} - will only try URL pattern`);
    return {
      domain: citation.domain || extractDomainFromUrl(url),
      title: citation.title,
      url: url,
      recencyScore: null,
      extractionMethod: 'problematic-domain',
      sourceType: citation.sourceType
    };
  }

  // Method 2: Try Firecrawl JSON extraction (if not skipped, not in test mode and API key available)
  if (!testMode && firecrawlApiKey && !skipFirecrawl) {
    try {
      const firecrawlDate = await extractDateWithFirecrawl(url, firecrawlApiKey);
      if (firecrawlDate) {
        return {
          domain: citation.domain || extractDomainFromUrl(url),
          title: citation.title,
          url: url,
          publicationDate: firecrawlDate,
          recencyScore: calculateRecencyScore(firecrawlDate),
          extractionMethod: 'firecrawl-json',
          sourceType: citation.sourceType
        };
      }
    } catch (error) {
      console.log(`Firecrawl JSON extraction failed for ${url}:`, error);
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

  // Method 3: Try Firecrawl HTML scraping (if not skipped, not in test mode and API key available)
  if (!testMode && firecrawlApiKey && !skipFirecrawl) {
    try {
      const scrapedDate = await scrapeDateWithFirecrawl(url, firecrawlApiKey);
      if (scrapedDate) {
        return {
          domain: citation.domain || extractDomainFromUrl(url),
          title: citation.title,
          url: url,
          publicationDate: scrapedDate,
          recencyScore: calculateRecencyScore(scrapedDate),
          extractionMethod: 'firecrawl-html',
          sourceType: citation.sourceType
        };
      }
    } catch (error) {
      console.log(`Firecrawl HTML scraping failed for ${url}:`, error);
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
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else if (pattern === patterns[1]) { // YYYY/MM or YYYY-MM
        const [, year, month] = match;
        return `${year}-${month.padStart(2, '0')}-01`;
      } else if (pattern === patterns[2]) { // YYYY
        const [, year] = match;
        return `${year}-01-01`;
      } else if (pattern === patterns[3]) { // Month DD, YYYY (full month names)
        const [, month, day, year] = match;
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else if (pattern === patterns[4]) { // Month DD, YYYY (abbreviated month names)
        const [, month, day, year] = match;
        const monthNum = getMonthNumber(month);
        if (monthNum) {
          return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
      }
    }
  }
  
  return null;
}

async function extractDateWithFirecrawl(url: string, apiKey: string): Promise<string | null> {
  try {
    // Use v2 scrape endpoint with prompt-only JSON mode
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
        body: JSON.stringify({
          url: url,
          formats: [{
            type: 'json',
            prompt: 'Find the publication date or review date on this page. Look for patterns like "Mar 14, 2022", "March 14, 2022", "2022-03-14", or similar date formats. Return the date in YYYY-MM-DD format. If no date is found, return null.'
          }],
          onlyMainContent: true,
          timeout: 30000 // 30 second timeout
        })
    });

    if (!response.ok) {
      if (response.status === 408) {
        console.log(`Firecrawl timeout (408) for ${url}, this is normal for slow websites`);
        return null;
      }
      if (response.status === 429) {
        console.log(`Firecrawl rate limit (429) for ${url}`);
        return null;
      }
      console.log(`Firecrawl API error: ${response.status} for ${url}`);
      return null;
    }

    const data = await response.json();
    
    if (data.success && data.data?.json) {
      // The LLM will return the date in various formats, try to extract it
      const jsonData = data.data.json;
      
      // Look for common date field names
      const dateFields = ['publicationDate', 'date', 'publishedDate', 'publishDate', 'createdDate'];
      let extractedDate = null;
      
      for (const field of dateFields) {
        if (jsonData[field]) {
          extractedDate = jsonData[field];
          break;
        }
      }
      
      // If no specific field found, look for any string that looks like a date
      if (!extractedDate) {
        for (const [key, value] of Object.entries(jsonData)) {
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            extractedDate = value;
            break;
          }
        }
      }
      
      if (extractedDate) {
        // Try to parse and format the date
        const date = new Date(extractedDate);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Firecrawl extraction error:', error);
    return null;
  }
}

async function scrapeDateWithFirecrawl(url: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
        body: JSON.stringify({
          url: url,
          formats: ['markdown'], // Use markdown for better date extraction
          onlyMainContent: true,
          timeout: 30000 // 30 second timeout
        })
    });

    if (!response.ok) {
      if (response.status === 408) {
        console.log(`Firecrawl timeout (408) for ${url}, this is normal for slow websites`);
        return null;
      }
      if (response.status === 429) {
        console.log(`Firecrawl rate limit (429) for ${url}`);
        return null;
      }
      console.log(`Firecrawl API error: ${response.status} for ${url}`);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown;
    
    if (!markdown) return null;

    // Look for date patterns in markdown (like "Mar 14, 2022")
    const datePatterns = [
      // Month DD, YYYY (e.g., "Mar 14, 2022")
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(\d{4})/i,
      // Full month DD, YYYY (e.g., "March 14, 2022")
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
      // YYYY-MM-DD
      /(\d{4})-(\d{1,2})-(\d{1,2})/,
      // MM/DD/YYYY
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      // DD/MM/YYYY
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
        } else if (pattern === datePatterns[3] || pattern === datePatterns[4]) { // MM/DD/YYYY or DD/MM/YYYY
          const [, part1, part2, year] = match;
          // Assume MM/DD/YYYY for now
          dateStr = `${year}-${part1.padStart(2, '0')}-${part2.padStart(2, '0')}`;
        }
        
        if (dateStr) {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Firecrawl scraping error:', error);
    return null;
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
    'reddit.com',
    'www.reddit.com',
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
