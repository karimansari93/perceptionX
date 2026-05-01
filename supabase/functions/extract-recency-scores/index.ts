import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Use service role key so cache writes bypass RLS. Edge function is server-side
// only and never exposes this key to clients.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
);

interface CitationWithRecency {
  domain: string;
  title?: string;
  url?: string;
  publicationDate?: string;
  recencyScore: number | null; // null = N/A
  extractionMethod: 'url-pattern' | 'firecrawl-metadata' | 'firecrawl-relative' | 'firecrawl-absolute' | 'firecrawl-reddit' | 'not-found' | 'rate-limit-hit' | 'cache-hit' | 'timeout' | 'manual' | 'evergreen';
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

    // Step 4a: Run free tiers (URL pattern + evergreen) synchronously.
    // Anything that doesn't resolve gets queued for one batch Firecrawl call.
    const urlsNeedingFirecrawl: string[] = [];
    for (const url of urlsToAnalyze) {
      const citationsForUrl = urlToCitations.get(url) || [];
      const firstCitation = citationsForUrl[0];

      const urlDate = extractDateFromUrl(url);
      if (urlDate) {
        urlResults.set(url, {
          domain: firstCitation?.domain || extractDomainFromUrl(url),
          title: firstCitation?.title,
          url,
          publicationDate: urlDate,
          recencyScore: calculateRecencyScore(urlDate),
          extractionMethod: 'url-pattern',
          sourceType: firstCitation?.sourceType,
        });
        continue;
      }

      if (isEvergreenUrl(url)) {
        urlResults.set(url, {
          domain: firstCitation?.domain || extractDomainFromUrl(url),
          title: firstCitation?.title,
          url,
          recencyScore: 100,
          extractionMethod: 'evergreen',
          sourceType: firstCitation?.sourceType,
        });
        continue;
      }

      urlsNeedingFirecrawl.push(url);
    }

    console.log(`URL pattern + evergreen handled: ${urlResults.size - cachedUrls.size}, Firecrawl needed: ${urlsNeedingFirecrawl.length}`);

    // Step 4b: One batch Firecrawl call (concurrent, much faster than per-URL).
    if (!testMode && firecrawlApiKey && urlsNeedingFirecrawl.length > 0) {
      const batchResults = await batchExtractDatesWithFirecrawl(urlsNeedingFirecrawl, firecrawlApiKey, maxProcessingTime - (Date.now() - startTime));
      firecrawlRequestCount = urlsNeedingFirecrawl.length;

      for (const url of urlsNeedingFirecrawl) {
        const citationsForUrl = urlToCitations.get(url) || [];
        const firstCitation = citationsForUrl[0];
        const batchResult = batchResults.get(url);

        if (batchResult?.date) {
          urlResults.set(url, {
            domain: firstCitation?.domain || extractDomainFromUrl(url),
            title: firstCitation?.title,
            url,
            publicationDate: batchResult.date,
            recencyScore: calculateRecencyScore(batchResult.date),
            extractionMethod: batchResult.method,
            sourceType: firstCitation?.sourceType,
          });
        } else {
          urlResults.set(url, {
            domain: firstCitation?.domain || extractDomainFromUrl(url),
            title: firstCitation?.title,
            url,
            recencyScore: null,
            extractionMethod: batchResult?.method || 'not-found',
            sourceType: firstCitation?.sourceType,
          });
        }
      }
    } else if (urlsNeedingFirecrawl.length > 0) {
      // No Firecrawl available — mark as not-found so we don't retry forever
      for (const url of urlsNeedingFirecrawl) {
        const citationsForUrl = urlToCitations.get(url) || [];
        const firstCitation = citationsForUrl[0];
        urlResults.set(url, {
          domain: firstCitation?.domain || extractDomainFromUrl(url),
          title: firstCitation?.title,
          url,
          recencyScore: null,
          extractionMethod: 'not-found',
          sourceType: firstCitation?.sourceType,
        });
      }
    }

    // Step 4c: Persist all newly-resolved URLs to cache (parallel writes).
    const newlyResolvedUrls = urlsToAnalyze.filter(u => urlResults.has(u));
    await Promise.all(
      newlyResolvedUrls
        .map(u => urlResults.get(u)!)
        .filter(r => r.extractionMethod !== 'rate-limit-hit' && r.extractionMethod !== 'cache-hit')
        .map(r => storeCachedUrl(r))
    );
    
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
          firecrawlRequestsMade: firecrawlRequestCount
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

// Batch scrape: send up to N URLs in one call, get all results back concurrently.
// Replaces per-URL scrape calls. Same credit cost (1/URL) but eliminates HTTP
// overhead and uses Firecrawl's internal concurrency.
async function batchExtractDatesWithFirecrawl(
  urls: string[],
  apiKey: string,
  maxWaitMs: number
): Promise<Map<string, { date: string | null; method: CitationWithRecency['extractionMethod'] }>> {
  const results = new Map<string, { date: string | null; method: CitationWithRecency['extractionMethod'] }>();

  // Initialize all URLs as not-found in case the batch fails partway
  for (const url of urls) {
    results.set(url, { date: null, method: 'not-found' });
  }

  try {
    const timeoutSeconds = Math.max(60, Math.min(120, Math.floor(maxWaitMs / 1000) - 10));
    console.log(`Submitting batch scrape: ${urls.length} URLs, wait timeout ${timeoutSeconds}s`);

    const response = await fetch('https://api.firecrawl.dev/v2/batch/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls,
        // JSON mode: LLM-powered date extraction (5 credits/page).
        // Metadata still comes free with every scrape so we check that first.
        formats: [{
          type: 'json',
          prompt:
            "Extract the publication date of this article in YYYY-MM-DD format. " +
            "Look for explicit publish/posted dates near the title, byline, or article header — " +
            "NOT comment timestamps, copyright years, or dates mentioned in the article body. " +
            "Date formats vary by region: '2016. 2. 24.' is Korean (Feb 24, 2016), " +
            "'平成28年2月24日' is Japanese, '2016年2月24日' is Chinese/Japanese. " +
            "If the page is a job listing, careers page, homepage, or has no clear publication date, return null.",
          schema: {
            type: 'object',
            properties: {
              publicationDate: {
                type: ['string', 'null'],
                description: 'Publication date in YYYY-MM-DD format, or null if no clear publication date is visible',
              },
            },
            required: ['publicationDate'],
          },
        }],
        onlyMainContent: false, // headers/bylines can be outside main content
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      console.error(`Batch scrape submit failed: ${response.status}`);
      if (response.status === 429) {
        for (const url of urls) results.set(url, { date: null, method: 'rate-limit-hit' });
      }
      return results;
    }

    const submitData = await response.json();
    const jobId = submitData.id;
    if (!jobId) {
      console.error('Batch scrape: no job ID returned');
      return results;
    }

    // Poll until complete or we run out of time
    const pollUrl = `https://api.firecrawl.dev/v2/batch/scrape/${jobId}`;
    const pollStart = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - pollStart < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const statusRes = await fetch(pollUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!statusRes.ok) {
        console.error(`Batch poll failed: ${statusRes.status}`);
        continue;
      }
      const statusData = await statusRes.json();
      console.log(`Batch progress: ${statusData.completed ?? 0}/${statusData.total ?? urls.length} (${statusData.status})`);

      if (statusData.status === 'completed' || statusData.status === 'failed') {
        // Process results — Firecrawl returns one entry per URL in data array
        const data = statusData.data || [];
        for (const entry of data) {
          const url = entry?.metadata?.sourceURL || entry?.metadata?.url;
          if (!url) continue;
          const dateResult = parseDateFromScrapeData(entry);
          results.set(url, dateResult);
        }
        return results;
      }
    }

    console.warn(`Batch poll timed out after ${maxWaitMs}ms — partial results only`);
    return results;
  } catch (err) {
    console.error('Batch scrape error:', err);
    return results;
  }
}

// Extract a date from a Firecrawl batch scrape entry. Tries metadata (free)
// first, then falls back to the LLM-extracted JSON output.
function parseDateFromScrapeData(scrapeEntry: any): { date: string | null; method: CitationWithRecency['extractionMethod'] } {
  const metadata = scrapeEntry?.metadata;

  // STEP 1: Metadata fields (free, comes with every scrape)
  if (metadata) {
    const dateFields = [
      metadata.publishedTime,
      metadata.modifiedTime,
      metadata.ogPublishedTime,
      metadata['article:published_time'],
      metadata.datePublished,
      metadata['og:published_time'],
    ];
    for (const field of dateFields) {
      if (field) {
        const validated = validateAndFormatDate(field);
        if (validated) {
          return { date: validated, method: 'firecrawl-metadata' };
        }
      }
    }
  }

  // STEP 2: LLM-extracted publication date (JSON mode, 5 credits/page).
  // Reliable across languages, scripts, and date formats.
  const jsonOutput = scrapeEntry?.json;
  const jsonDate = jsonOutput?.publicationDate;
  if (jsonDate && typeof jsonDate === 'string') {
    const validated = validateAndFormatDate(jsonDate);
    if (validated) {
      return { date: validated, method: 'firecrawl-json' };
    }
  }

  return { date: null, method: 'not-found' };
}

// Reject impossible/suspicious dates:
// - pre-1995 (web didn't exist meaningfully) or >2050
// - >30 days in the future (typo or "today" false positive)
// - exactly today's date (almost always a bug — pages rarely publish and get
//   scraped on the same UTC day in practice; usually means we matched "today"
//   somewhere in the page text instead of a real publish date)
function validateAndFormatDate(input: string): string | null {
  try {
    const d = new Date(input);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    if (year < 1995 || year > 2050) return null;
    const now = new Date();
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (d > thirtyDaysAhead) return null;
    const formatted = d.toISOString().split('T')[0];
    const todayFormatted = now.toISOString().split('T')[0];
    if (formatted === todayFormatted) return null;
    return formatted;
  } catch {
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

// Evergreen detection: URLs that don't have a meaningful publication date
// (homepages, /about, /careers, job listings, ATS portals, pricing, etc.).
// Returns true => skip Firecrawl, treat as always-current (score 100).
function isEvergreenUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

  // Bare homepage / domain root
  if (path === '' || path === '/') return true;

  // ATS / job-board hostnames — treat the whole domain as evergreen
  const evergreenHosts = [
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
    'jobs.lever.co',
    'jobs.ashbyhq.com',
    'apply.workable.com',
    'recruiterbox.com',
    'breezy.hr',
    'smartrecruiters.com',
    'myworkdayjobs.com',
  ];
  if (evergreenHosts.some(h => host === h || host.endsWith('.' + h))) return true;

  // Workday tenant URLs: *.myworkday.com or *.wd*.myworkdayjobs.com
  if (/(^|\.)myworkdayjobs\.com$/.test(host)) return true;

  // LinkedIn job postings/pages (not articles)
  if (host.endsWith('linkedin.com') && /^\/jobs(\/|$)/.test(path)) return true;
  if (host.endsWith('linkedin.com') && /^\/company\/[^/]+\/?$/.test(path)) return true;

  // Indeed job pages (not articles)
  if (host.endsWith('indeed.com') && /^\/(viewjob|jobs|cmp)(\/|$|\?)/.test(path)) return true;

  // Glassdoor company / job pages (not articles)
  if (host.endsWith('glassdoor.com') && /^\/(overview|jobs|reviews|salary|salaries|benefits|interview|interviews)(\/|$)/i.test(path)) return true;

  // Path-based patterns. Use exact root or first-segment match to avoid catching
  // legitimate articles like /blog/the-future-of-careers (only matches /careers,
  // /careers/, /careers/jobs/...).
  const evergreenFirstSegments = [
    'about', 'about-us', 'aboutus',
    'company', 'our-company', 'who-we-are',
    'team', 'teams', 'leadership', 'people',
    'mission', 'values', 'our-story', 'story', 'culture',
    'careers', 'career', 'jobs', 'job', 'positions', 'openings',
    'vacancies', 'opportunities', 'work-with-us', 'join-us', 'join',
    'pricing', 'plans', 'products', 'product', 'features', 'solutions',
    'contact', 'contact-us', 'support', 'help',
    'investors', 'press', 'media', 'newsroom',
  ];
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 1 && evergreenFirstSegments.includes(segments[0])) {
    return true;
  }

  // ATS-style sub-paths on company sites: /careers/jobs/12345, /about/team/...
  // already covered by first-segment match above. Also catch nested /jobs/ later
  // in path (e.g. /en/careers/jobs/...).
  if (segments.some(s => ['jobs', 'careers', 'job', 'positions', 'openings'].includes(s))) {
    return true;
  }

  return false;
}

