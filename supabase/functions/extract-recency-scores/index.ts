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
  extractionMethod: 'url-pattern' | 'firecrawl-metadata' | 'firecrawl-relative' | 'firecrawl-absolute' | 'firecrawl-reddit' | 'firecrawl-json' | 'meta-tag' | 'json-ld' | 'time-tag' | 'openai-html' | 'not-found' | 'rate-limit-hit' | 'cache-hit' | 'timeout' | 'manual' | 'evergreen' | 'youtube-api' | 'reddit-api' | 'social-post' | 'problematic-domain' | 'url-duplicate';
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
  
  // Last-line guard: an invalid date would make Postgres reject the upsert,
  // leaving the URL uncached and re-analyzed on every future run. Better to
  // cache it dateless than to retry it forever.
  const publicationDate =
    citation.publicationDate && isRealDate(citation.publicationDate)
      ? citation.publicationDate
      : null;

  const cacheData = {
    url: citation.url,
    domain: citation.domain,
    publication_date: publicationDate,
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
    const { citations, testMode = false, bypassCache = false } = await req.json();

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
    
    // Step 1: Canonicalize, then deduplicate URLs within this batch. Canonical-
    // ization unwraps Google redirect wrappers and strips fragments/tracking
    // params, so every downstream tier works on the real destination. Two
    // different wrappers around the same article collapse to one analysis.
    const urlToCitations = new Map<string, typeof citations>();
    const uniqueUrls: string[] = [];
    // raw citation URL -> canonical URL. Only holds entries where they differ.
    const rawToCanonical = new Map<string, string>();

    for (const citation of citations) {
      const rawUrl = citation.url || citation.link;
      if (rawUrl) {
        const url = canonicalizeUrl(rawUrl);
        if (url !== rawUrl) rawToCanonical.set(rawUrl, url);
        if (!urlToCitations.has(url)) {
          urlToCitations.set(url, []);
          uniqueUrls.push(url);
        }
        urlToCitations.get(url)!.push(citation);
      }
    }

    console.log(`Deduplication: ${citations.length} citations reduced to ${uniqueUrls.length} unique URLs (${rawToCanonical.size} canonicalized)`);
    
    // canonical URL -> the raw citation URLs that collapsed onto it.
    const canonicalToRaws = new Map<string, string[]>();
    for (const [raw, canonical] of rawToCanonical) {
      const list = canonicalToRaws.get(canonical);
      if (list) list.push(raw);
      else canonicalToRaws.set(canonical, [raw]);
    }

    // Step 2: Check cache for unique URLs (unless bypassCache is set — used by
    // backfill jobs that want to re-score existing rows via the new pipeline).
    // Pre-canonical URLs are looked up too: rows cached before canonicalization
    // existed are keyed by the raw URL, and re-analyzing them would spend
    // credits to relearn what we already know.
    const lookupUrls = [...uniqueUrls, ...rawToCanonical.keys()];
    console.log(`Looking up ${lookupUrls.length} URLs in cache (${uniqueUrls.length} canonical + ${rawToCanonical.size} pre-canonical, bypassCache=${bypassCache})`);
    const cachedUrls = bypassCache ? new Map() : await getCachedUrls(lookupUrls);
    console.log(`Cache lookup complete: Found ${cachedUrls.size} cached URLs`);

    // Step 3: Build results map for unique URLs
    const urlResults = new Map<string, CitationWithRecency>();
    const urlsToAnalyze: string[] = [];

    for (const url of uniqueUrls) {
      const cached = cachedUrls.get(url)
        ?? (canonicalToRaws.get(url) ?? []).map(raw => cachedUrls.get(raw)).find(Boolean);
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

    // Step 4a: Run free tiers (URL pattern + evergreen) synchronously, then
    // batched YouTube / concurrent Reddit API calls. Anything that doesn't
    // resolve gets queued for one batch Firecrawl call.
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY') || null;
    const youtubeCandidates = new Map<string, string>(); // url -> videoId
    const redditCandidates: string[] = [];
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

      // Static deny-list: known-dateless domains that reliably fail every scrape
      // tier. Classify terminally now so they never reach YouTube/Reddit/Firecrawl.
      const dateless = classifyDatelessUrl(url);
      if (dateless) {
        urlResults.set(url, {
          domain: firstCitation?.domain || extractDomainFromUrl(url),
          title: firstCitation?.title,
          url,
          recencyScore: null,
          extractionMethod: dateless.method,
          sourceType: firstCitation?.sourceType,
        });
        continue;
      }

      if (youtubeApiKey) {
        const videoId = parseYouTubeVideoId(url);
        if (videoId) {
          youtubeCandidates.set(url, videoId);
          continue;
        }
      }

      if (isRedditUrl(url)) {
        redditCandidates.push(url);
        continue;
      }

      urlsNeedingFirecrawl.push(url);
    }

    console.log(`URL pattern + evergreen handled: ${urlResults.size - cachedUrls.size}, youtube candidates: ${youtubeCandidates.size}, reddit candidates: ${redditCandidates.length}, candidates for cheap tiers: ${urlsNeedingFirecrawl.length}`);

    // Step 4a.i: YouTube Data API (batched, up to 50 IDs per call)
    if (!testMode && youtubeApiKey && youtubeCandidates.size > 0) {
      const ytResults = await extractYouTubeDates(youtubeCandidates, youtubeApiKey);
      for (const [url, videoId] of youtubeCandidates) {
        const citationsForUrl = urlToCitations.get(url) || [];
        const firstCitation = citationsForUrl[0];
        const date = ytResults.get(url);
        if (date) {
          urlResults.set(url, {
            domain: firstCitation?.domain || extractDomainFromUrl(url),
            title: firstCitation?.title,
            url,
            publicationDate: date,
            recencyScore: calculateRecencyScore(date),
            extractionMethod: 'youtube-api',
            sourceType: firstCitation?.sourceType,
          });
        } else {
          // API failed / quota exhausted / video not found — fall through
          urlsNeedingFirecrawl.push(url);
        }
      }
      console.log(`YouTube API resolved ${ytResults.size}/${youtubeCandidates.size}`);
    } else if (youtubeCandidates.size > 0) {
      // testMode or no key — fall through
      for (const url of youtubeCandidates.keys()) urlsNeedingFirecrawl.push(url);
    }

    // Step 4a.ii: Reddit .json endpoint (concurrent, capped).
    // Reddit is classified by the API, not by scraping: Reddit blocks Firecrawl,
    // so a thread the API can't date is one nothing else can date either. When
    // the API answered (tokenOk) a miss is terminal — we do NOT pay Firecrawl to
    // fail. When the token itself failed the miss says nothing about the thread,
    // so leave those URLs unresolved and uncached for a later run to retry.
    if (!testMode && redditCandidates.length > 0) {
      const { dates: rdResults, tokenOk } = await extractRedditDates(redditCandidates);
      for (const url of redditCandidates) {
        const citationsForUrl = urlToCitations.get(url) || [];
        const firstCitation = citationsForUrl[0];
        const date = rdResults.get(url);
        if (date) {
          urlResults.set(url, {
            domain: firstCitation?.domain || extractDomainFromUrl(url),
            title: firstCitation?.title,
            url,
            publicationDate: date,
            recencyScore: calculateRecencyScore(date),
            extractionMethod: 'reddit-api',
            sourceType: firstCitation?.sourceType,
          });
        } else if (tokenOk) {
          // Deleted, removed, quarantined or private thread. Terminal.
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
      console.log(`Reddit API resolved ${rdResults.size}/${redditCandidates.length} (tokenOk=${tokenOk}); Firecrawl fall-through: 0`);
    } else if (redditCandidates.length > 0) {
      for (const url of redditCandidates) urlsNeedingFirecrawl.push(url);
    }

    // Step 4b: Cheap tiers — plain HTTP fetch + meta-tag parse, then OpenAI on the
    // fetched HTML if no meta tag found. Both are vastly cheaper than Firecrawl.
    // Anything that still doesn't resolve goes to the Firecrawl batch below.
    const openAIKey = Deno.env.get('OPENAI_API_KEY') || null;
    let tier2Hits = 0;
    let tier3Hits = 0;
    if (!testMode && urlsNeedingFirecrawl.length > 0) {
      const cheapResults = await runTier2And3(urlsNeedingFirecrawl, openAIKey);
      const stillNeedingFirecrawl: string[] = [];
      for (const url of urlsNeedingFirecrawl) {
        const r = cheapResults.get(url);
        if (r) {
          const citationsForUrl = urlToCitations.get(url) || [];
          const firstCitation = citationsForUrl[0];
          urlResults.set(url, {
            domain: firstCitation?.domain || extractDomainFromUrl(url),
            title: firstCitation?.title,
            url,
            publicationDate: r.date,
            recencyScore: calculateRecencyScore(r.date),
            extractionMethod: r.method,
            sourceType: firstCitation?.sourceType,
          });
          if (r.method === 'openai-html') tier3Hits++;
          else tier2Hits++;
        } else {
          stillNeedingFirecrawl.push(url);
        }
      }
      urlsNeedingFirecrawl.length = 0;
      urlsNeedingFirecrawl.push(...stillNeedingFirecrawl);
      console.log(`Cheap tiers: meta/json-ld/time-tag=${tier2Hits}, openai-html=${tier3Hits}, still need Firecrawl=${urlsNeedingFirecrawl.length}`);
    }

    // Step 4b.i: Dynamic deny-list. Drop domains that history proves almost never
    // yield a date (firecrawl_dead_domains MV) from the paid Firecrawl tier and
    // mark them not-found. The free tiers above already ran, so a domain that
    // starts exposing dates again is still caught cheaply; we only refuse to PAY
    // to re-scrape a domain that has failed ~everything ~every time.
    if (!testMode && firecrawlApiKey && urlsNeedingFirecrawl.length > 0) {
      const deadDomains = await loadDeadDomains();
      if (deadDomains.size > 0) {
        const stillNeedingFirecrawl: string[] = [];
        let deadSkipped = 0;
        for (const url of urlsNeedingFirecrawl) {
          if (deadDomains.has(extractDomainFromUrl(url))) {
            const citationsForUrl = urlToCitations.get(url) || [];
            const firstCitation = citationsForUrl[0];
            urlResults.set(url, {
              domain: firstCitation?.domain || extractDomainFromUrl(url),
              title: firstCitation?.title,
              url,
              // 'problematic-domain', not 'not-found': we declined to scrape this
              // rather than scraped and failed. The deny-list view excludes these
              // so a denied domain can age off the list and get another chance,
              // instead of its own skips keeping it there forever.
              recencyScore: null,
              extractionMethod: 'problematic-domain',
              sourceType: firstCitation?.sourceType,
            });
            deadSkipped++;
          } else {
            stillNeedingFirecrawl.push(url);
          }
        }
        urlsNeedingFirecrawl.length = 0;
        urlsNeedingFirecrawl.push(...stillNeedingFirecrawl);
        console.log(`Dead-domain deny-list: skipped ${deadSkipped} URLs, remaining for Firecrawl: ${urlsNeedingFirecrawl.length}`);
      }
    }

    // Step 4c: One batch Firecrawl call (concurrent, much faster than per-URL).
    if (!testMode && firecrawlApiKey && urlsNeedingFirecrawl.length > 0) {
      const batchResults = await batchExtractDatesWithFirecrawl(urlsNeedingFirecrawl, firecrawlApiKey, maxProcessingTime - (Date.now() - startTime), openAIKey);
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

    // Step 4d: Persist all newly-resolved URLs to cache (parallel writes).
    const newlyResolvedUrls = urlsToAnalyze.filter(u => urlResults.has(u));
    const rowsToStore = newlyResolvedUrls
      .map(u => urlResults.get(u)!)
      .filter(r => r.extractionMethod !== 'rate-limit-hit' && r.extractionMethod !== 'cache-hit');

    // Also cache each pre-canonical URL that collapsed onto a resolved one, so a
    // future batch citing the same wrapper hits the cache instead of unwrapping
    // and re-analyzing. The row carries the destination's date, score and domain
    // — the wrapper is only an alias for it.
    //
    // This covers cache hits as well as freshly-analyzed URLs, and that is not
    // an optimization: the rescore tick pulls URLs with no cache row and counts
    // progress by how many of them have one afterwards. A wrapper whose
    // destination was already cached does no work here, so without a row of its
    // own it would be re-pulled every tick and the job would stall at zero
    // progress. Most wrappers hit exactly that path.
    const aliasRows: CitationWithRecency[] = [];
    for (const [canonical, raws] of canonicalToRaws) {
      const resolved = urlResults.get(canonical);
      if (!resolved || resolved.extractionMethod === 'rate-limit-hit') continue;
      for (const raw of raws) {
        if (cachedUrls.has(raw)) continue; // already has a row of its own
        aliasRows.push({ ...resolved, url: raw, extractionMethod: 'url-duplicate' });
      }
    }

    await Promise.all([...rowsToStore, ...aliasRows].map(r => storeCachedUrl(r)));
    
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
      
      const urlResult = urlResults.get(rawToCanonical.get(url) ?? url);
      if (urlResult) {
        // Add citation-specific fields back. The URL echoed to the caller is the
        // one it sent us, not the canonical form, so callers can still match
        // results to the citations they passed in.
        results.push({
          ...urlResult,
          url,
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

// The url_recency_cache.publication_date column is a real DATE: a string like
// "2016-17-01" (a "2016-17" season/fiscal-year URL fragment read as month 17)
// makes Postgres reject the row with "date/time field value out of range", the
// URL never gets cached, and the rescore tick retries it every run forever.
// Every extracted date must pass this before it is returned/stored.
function isRealDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1990 || y > 2050) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ----------------------------------------------------------------------------
// URL canonicalization. Search engines cite articles through redirect wrappers
// (google.com/url?...&url=<destination>) rather than linking them directly.
// Scraping the wrapper yields a redirect stub with no date, so every one of them
// used to run the full tier stack and end at not-found — while the tracking
// params in the wrapper (ved, psig, ust=<epoch micros>) fed the URL date parser
// garbage, producing publication dates from 1970 to 2047.
//
// Unwrapping to the destination fixes both: the URL we analyze is the real
// article, and many of them are already in the cache from being cited directly
// elsewhere, so they cost nothing at all.
// ----------------------------------------------------------------------------
const REDIRECT_DESTINATION_PARAMS = ['url', 'imgurl', 'q', 'u'];
// Google's own params, used to find where the destination ends. Google leaves
// the destination unencoded ("url=https://host/a?b=1&c=2"), so searchParams
// would cut it at its first "&" and hand back a truncated URL.
const GOOGLE_WRAPPER_PARAMS = [
  'ved', 'usg', 'sa', 'psig', 'ust', 'opi', 'cd', 'source', 'rct',
  'uoh', 'ei', 'bvm', 'cad', 'uact', 'client', 'sqi', 'fir', 'tbm',
];

function extractDestination(search: string, param: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const start = query.match(new RegExp(`(?:^|&)${param}=`));
  if (!start) return null;

  const rest = query.slice((start.index ?? 0) + start[0].length);
  const terminator = rest.match(new RegExp(`&(?:${GOOGLE_WRAPPER_PARAMS.join('|')})(?:=|&|$)`));
  const value = terminator ? rest.slice(0, terminator.index) : rest;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed escape sequence — the raw value is still worth a look.
  }
  // Google also wraps opaque "CAES..." blobs that decode to nothing useful.
  // Only an actual http(s) destination is worth following.
  if (!/^https?:\/\/./i.test(decoded)) return null;
  try {
    new URL(decoded);
  } catch {
    return null;
  }
  return decoded;
}

// One unwrap step. Returns the destination, or null if this isn't a wrapper.
function unwrapRedirect(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  // google.com, google.co.uk, google.com.br, ...
  if (!/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return null;
  if (!/^\/(url|goto|imgres|aclk)$/.test(parsed.pathname.replace(/\/+$/, ''))) return null;

  for (const param of REDIRECT_DESTINATION_PARAMS) {
    const destination = extractDestination(parsed.search, param);
    if (destination) return destination;
  }
  return null;
}

// Strip text-fragment anchors (#:~:text=...) and common tracking params. Both
// produce distinct cache keys for what is one page. Other fragments are left
// alone — some sites route on them.
function stripUrlNoise(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  let changed = false;
  if (parsed.hash.startsWith('#:~:')) {
    parsed.hash = '';
    changed = true;
  }
  for (const param of [...parsed.searchParams.keys()]) {
    if (/^utm_/i.test(param) || ['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid'].includes(param.toLowerCase())) {
      parsed.searchParams.delete(param);
      changed = true;
    }
  }

  // Return the input untouched when there was nothing to strip. URL.toString()
  // also normalizes case, default ports and escaping, and that rewriting would
  // change the cache key of URLs that have no noise in them at all — turning
  // every existing cache row into a miss and re-analyzing the whole corpus.
  return changed ? parsed.toString() : url;
}

function canonicalizeUrl(rawUrl: string): string {
  let current = rawUrl;
  // Wrappers occasionally nest (a Google redirect around another redirect).
  // Cap the hops so a self-referential URL can't spin here.
  for (let hop = 0; hop < 3; hop++) {
    const next = unwrapRedirect(current);
    if (!next || next === current) break;
    current = next;
  }
  return stripUrlNoise(current);
}

function extractDateFromUrl(url: string): string | null {
  // Helper to validate year is reasonable (web content dates)
  const isValidYear = (year: string): boolean => {
    const yearNum = parseInt(year, 10);
    return yearNum >= 1990 && yearNum <= 2050; // Reasonable range for web content
  };

  // Match against the path only. Query strings and fragments carry epoch
  // timestamps, session ids and highlight text, none of which are publication
  // dates — reading them is how "2047-01-01" got into the cache.
  try {
    url = new URL(url).pathname;
  } catch {
    url = url.split('#')[0].split('?')[0];
  }

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
      let candidate: string | null = null;
      if (pattern === patterns[0]) { // YYYY/MM/DD or YYYY-MM-DD
        const [, year, month, day] = match;
        if (!isValidYear(year)) continue;
        candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else if (pattern === patterns[1]) { // YYYY/MM or YYYY-MM
        const [, year, month] = match;
        if (!isValidYear(year)) continue;
        candidate = `${year}-${month.padStart(2, '0')}-01`;
      } else if (pattern === patterns[2]) { // YYYY
        const [, year] = match;
        if (!isValidYear(year)) continue;
        candidate = `${year}-01-01`;
      } else if (pattern === patterns[3]) { // Month DD, YYYY (full month names)
        const [, month, day, year] = match;
        if (!isValidYear(year)) continue;
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        candidate = `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
      } else if (pattern === patterns[4]) { // Month DD, YYYY (abbreviated month names)
        const [, month, day, year] = match;
        if (!isValidYear(year)) continue;
        const monthNum = getMonthNumber(month);
        if (monthNum) {
          candidate = `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
      }
      if (candidate && isRealDate(candidate)) return candidate;
    }
  }
  
  return null;
}

// ----------------------------------------------------------------------------
// Tier 2: plain fetch + HTML meta-tag parsing. Free. Catches ~50% of URLs that
// would otherwise hit Firecrawl. Returns {date, method, html?} — html is kept
// so Tier 3 can run OpenAI extraction on the same HTML without a second fetch.
// ----------------------------------------------------------------------------
const TIER2_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeDateString(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (isRealDate(d)) return d;
  }
  const slash = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const d = `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
    if (isRealDate(d)) return d;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    const out = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (isRealDate(out)) return out;
  }
  return null;
}

function extractDateFromHtml(html: string): { date: string | null; method: 'meta-tag' | 'json-ld' | 'time-tag' | null } {
  // OpenGraph article:published_time (most reliable)
  let m = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i);
  if (m) { const d = normalizeDateString(m[1]); if (d) return { date: d, method: 'meta-tag' }; }
  m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);
  if (m) { const d = normalizeDateString(m[1]); if (d) return { date: d, method: 'meta-tag' }; }

  // Other standard meta names
  const metaNames = ['date', 'DC.date.issued', 'pubdate', 'publishdate', 'publication_date', 'article:published', 'sailthru.date', 'parsely-pub-date'];
  for (const n of metaNames) {
    const re = new RegExp(`<meta[^>]+name=["']${n.replace(/\./g, '\\.')}["'][^>]+content=["']([^"']+)["']`, 'i');
    const mm = html.match(re);
    if (mm) { const d = normalizeDateString(mm[1]); if (d) return { date: d, method: 'meta-tag' }; }
  }

  // JSON-LD datePublished / dateCreated / uploadDate (covers YouTube too)
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld;
  while ((ld = ldRe.exec(html)) !== null) {
    try {
      const cleaned = ld[1].trim().replace(/^﻿/, '');
      const obj = JSON.parse(cleaned);
      const stack: any[] = [obj];
      while (stack.length) {
        const cur = stack.pop();
        if (cur && typeof cur === 'object') {
          for (const key of ['datePublished', 'dateCreated', 'uploadDate', 'datePosted']) {
            if (cur[key]) {
              const d = normalizeDateString(cur[key]);
              if (d) return { date: d, method: 'json-ld' };
            }
          }
          if (Array.isArray(cur)) stack.push(...cur);
          else stack.push(...Object.values(cur));
        }
      }
    } catch { /* malformed JSON-LD, skip */ }
  }

  // YouTube fallback: "uploadDate":"..." appears in ytInitialPlayerResponse
  const yt = html.match(/"uploadDate"\s*:\s*"([^"]+)"/);
  if (yt) { const d = normalizeDateString(yt[1]); if (d) return { date: d, method: 'json-ld' }; }

  // <time datetime="...">
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (time) { const d = normalizeDateString(time[1]); if (d) return { date: d, method: 'time-tag' }; }

  return { date: null, method: null };
}

async function tier2FetchAndExtract(url: string, timeoutMs = 8000): Promise<{ date: string | null; method: 'meta-tag' | 'json-ld' | 'time-tag' | null; html: string | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': TIER2_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { date: null, method: null, html: null, error: `HTTP ${res.status}` };
    // Cap response size to 1MB to avoid pulling huge PDFs/binaries into memory
    const html = (await res.text()).slice(0, 1_000_000);
    const { date, method } = extractDateFromHtml(html);
    return { date, method, html, error: null };
  } catch (e: any) {
    return { date: null, method: null, html: null, error: e.name === 'AbortError' ? 'timeout' : (e?.message ?? 'fetch_error') };
  }
}

// Tier 3: OpenAI gpt-4.1-nano extraction on Tier-2's HTML. Only called when meta
// parsing returned nothing. ~$0.0005 per call vs ~25 Firecrawl credits.
async function tier3OpenAIExtract(html: string, openAIKey: string): Promise<string | null> {
  // Strip scripts/styles, then take a 6k-char window near the top where bylines live.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 6000);
  if (cleaned.length < 200) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openAIKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-nano',
        temperature: 0,
        max_tokens: 30,
        messages: [
          { role: 'system', content: "Extract the publication date of this article in YYYY-MM-DD format. Look for explicit publish/posted dates near the title, byline, or article header — NOT comment timestamps, copyright years, or dates mentioned in the article body. If you can't find a clear publication date, respond with exactly 'null'. Respond with ONLY the date or 'null', nothing else." },
          { role: 'user', content: cleaned },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!out || out.toLowerCase() === 'null') return null;
    return normalizeDateString(out);
  } catch {
    return null;
  }
}

// Run Tier 2 (and Tier 3 fallback) for a list of URLs in parallel. Returns a
// map of url => result. URLs that produced no date stay missing from the map.
async function runTier2And3(urls: string[], openAIKey: string | null, concurrency = 12): Promise<Map<string, { date: string; method: CitationWithRecency['extractionMethod'] }>> {
  const results = new Map<string, { date: string; method: CitationWithRecency['extractionMethod'] }>();
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const myIdx = idx++;
      const url = urls[myIdx];
      const r = await tier2FetchAndExtract(url);
      if (r.date && r.method) {
        results.set(url, { date: r.date, method: r.method });
        continue;
      }
      // Tier 3 only if fetch succeeded but no date found
      if (r.html && openAIKey) {
        const aiDate = await tier3OpenAIExtract(r.html, openAIKey);
        if (aiDate) {
          results.set(url, { date: aiDate, method: 'openai-html' });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results;
}

// Batch scrape: send up to N URLs in one call, get all results back concurrently.
// Replaces per-URL scrape calls. Same credit cost (1/URL) but eliminates HTTP
// overhead and uses Firecrawl's internal concurrency.
async function batchExtractDatesWithFirecrawl(
  urls: string[],
  apiKey: string,
  maxWaitMs: number,
  openAIKey: string | null
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
        // markdown only — base credit cost. Firecrawl's JSON extraction was billing
        // 25-290 credits/page; we now run gpt-4.1-nano on the markdown ourselves
        // for a fraction of the cost. Metadata still comes free with every scrape.
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 30000,
        // Force basic proxies (1 credit). Firecrawl defaults to proxy: 'auto',
        // which silently retries failures on enhanced proxies at 5 credits/URL.
        // The domains that fail basic proxies (Instagram, Facebook, TikTok,
        // Glassdoor, Google) return no publication date anyway, so paying 5x to
        // fail is strictly worse than paying 1x to fail.
        proxy: 'basic',
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
        // Process results — Firecrawl returns one entry per URL in data array.
        // For each entry: first try metadata (free), then OpenAI on the returned
        // markdown (cheap). We do the OpenAI pass in parallel.
        const data = statusData.data || [];
        const entries: Array<{ url: string; entry: any }> = [];
        for (const entry of data) {
          const url = entry?.metadata?.sourceURL || entry?.metadata?.url;
          if (!url) continue;
          entries.push({ url, entry });
        }

        // Phase 1: metadata-only (synchronous, no network)
        const needsOpenAI: Array<{ url: string; markdown: string }> = [];
        for (const { url, entry } of entries) {
          const metaResult = parseDateFromScrapeMetadata(entry);
          if (metaResult.date) {
            results.set(url, metaResult);
          } else if (openAIKey && typeof entry?.markdown === 'string' && entry.markdown.length > 100) {
            needsOpenAI.push({ url, markdown: entry.markdown });
          } else {
            results.set(url, { date: null, method: 'not-found' });
          }
        }

        // Phase 2: parallel OpenAI extraction on the markdown
        if (needsOpenAI.length > 0 && openAIKey) {
          console.log(`Running gpt-4.1-nano on ${needsOpenAI.length} markdowns from Firecrawl`);
          await Promise.all(needsOpenAI.map(async ({ url, markdown }) => {
            const cleaned = markdown.replace(/\s+/g, ' ').slice(0, 6000);
            const aiDate = await tier3OpenAIExtract(cleaned, openAIKey);
            if (aiDate) {
              results.set(url, { date: aiDate, method: 'openai-html' });
            } else {
              results.set(url, { date: null, method: 'not-found' });
            }
          }));
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

// Extract a date from Firecrawl's free metadata fields. No LLM call.
function parseDateFromScrapeMetadata(scrapeEntry: any): { date: string | null; method: CitationWithRecency['extractionMethod'] } {
  const metadata = scrapeEntry?.metadata;
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

  // PDFs: Firecrawl charges 1 credit per page of PDF (can be 50+ credits for one URL).
  // Date extraction from PDFs is also unreliable. Skip them entirely.
  if (/\.pdf(\?|$)/i.test(path) || /\.pdf(\?|$)/i.test(parsed.search)) return true;

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

  // Glassdoor company / job pages (not articles) — covers all TLDs (.com, .de, .br, .com.mx, etc.)
  if (/(^|\.)glassdoor\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)
      && /^\/(überblick|uberblick|overview|jobs|reviews|salary|salaries|salarios|salaires|gehalt|gehälter|stipendi|beneficios|benefits|benefícios|beneficios|interview|interviews|entrevista|entrevistas|empleos|empleo|empresas|arbeiten-bei)(\/|$)/i.test(path)) {
    return true;
  }

  // Social media — only treat *profile/account* pages as evergreen. Individual
  // posts (Reddit comments, FB posts, IG photos, etc.) have real publication
  // dates that matter for recency scoring — don't mask them with evergreen.
  // The cheap-tier pipeline (plain fetch + Firecrawl markdown) will try; if it
  // fails, the URL ends up as not-found which is the honest answer.
  if (/(^|\.)twitter\.com$/.test(host) && (path === '' || /^\/[^/]+\/?$/.test(path))) return true;
  if (/(^|\.)x\.com$/.test(host) && (path === '' || /^\/[^/]+\/?$/.test(path))) return true;
  if (host.endsWith('linkedin.com') && /^\/company\/[^/]+\/?$/.test(path)) return true;

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
    'finance', 'financing', 'credit',
    'responsibilities', 'responsibility', 'sustainability', 'esg',
    'corporate', 'corporate-info', 'overview',
    'benefits', 'rewards', 'compensation', 'perks',
    // Multi-language careers/about
    'karriere', 'karriär', 'karriere-bei-uns', 'arbeit', 'arbeitgeber',
    'empleo', 'empleos', 'empleo-y-carrera', 'trabajo', 'trabajos', 'ofertas',
    'carriere', 'carrière', 'carrieres', 'carrières', 'recrutement',
    'lavoro', 'lavora-con-noi', 'opportunita',
    'trabalhe-conosco', 'carreiras', 'vagas',
    'unternehmen', 'firma', 'wer-wir-sind', 'über-uns', 'uber-uns',
    'nachhaltigkeit', 'duurzaamheid', 'soziales-engagement',
  ];
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 1 && evergreenFirstSegments.includes(segments[0])) {
    return true;
  }
  // Brand-prefixed first segments: /about-ford/..., /experience-ford/..., /about_toyota/...
  // These are evergreen corporate pages on company websites (sustainability, benefits, etc.).
  if (segments.length >= 1 && /^(about|experience|our|nuestra|nossa|chez)[-_]/.test(segments[0])) {
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

// ----------------------------------------------------------------------------
// Static deny-list: domains/paths that NEVER yield a usable publication date and
// reliably fail every scrape tier (login walls, search-result pages, doc-viewer
// shells behind bot protection). Classifying them terminally BEFORE any tier
// means we never spend a Firecrawl credit — least of all a 5-credit enhanced
// retry — failing on them. Backed by production not-found data: these were the
// highest-volume dateless domains in url_recency_cache.
//
// Returns a terminal method to cache, or null to let the normal pipeline run.
//   - social-post: a real post whose date exists but is unreachable (auth wall)
//   - not-found:   no publication date exists for this kind of page at all
function classifyDatelessUrl(url: string): { method: CitationWithRecency['extractionMethod'] } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

  // Login-walled social networks. Individual posts have real dates but are
  // unreachable without authentication; every scrape (incl. enhanced proxies)
  // returns a login/consent shell. Mark social-post (null score) — honest and
  // terminal. (twitter/x profiles + linkedin company pages are handled as
  // evergreen elsewhere; these are the ones that otherwise burn scrapes.)
  const socialHosts = ['instagram.com', 'facebook.com', 'fb.com', 'tiktok.com'];
  if (socialHosts.some((h) => host === h || host.endsWith('.' + h))) {
    return { method: 'social-post' };
  }

  // Google search / maps / vertical result pages — no publication date exists.
  // (Redirect wrappers are unwrapped to their destination before reaching here.)
  if (/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && /^\/(search|maps|travel|flights|shopping|store)(\/|$)/.test(path)) {
    return { method: 'problematic-domain' };
  }

  // Document-hosting viewers behind bot walls — a scrape returns the viewer
  // shell, never a date.
  const deadDocHosts = ['scribd.com', 'studocu.com'];
  if (deadDocHosts.some((h) => host === h || host.endsWith('.' + h))) {
    return { method: 'problematic-domain' };
  }

  return null;
}

// Dynamic deny-list: domains that history proves almost never yield a date.
// Loaded from the firecrawl_dead_domains materialized view (refreshed daily).
// Used ONLY to skip the paid Firecrawl tier — the free tiers still run — so if a
// dead domain starts exposing dates again the cheap tiers will still catch it,
// and the MV (a rolling 90-day window) drops it back off automatically.
// Fails open: any error → empty set → normal behavior.
async function loadDeadDomains(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('firecrawl_dead_domains')
      .select('domain');
    if (error) {
      console.warn('Dead-domain deny-list load failed (proceeding without it):', error.message);
      return new Set();
    }
    return new Set((data ?? []).map((r: { domain: string }) => r.domain));
  } catch (e) {
    console.warn('Dead-domain deny-list load threw (proceeding without it):', e);
    return new Set();
  }
}

// ----------------------------------------------------------------------------
// YouTube Data API v3 extractor. Free (10K quota units/day; 1 unit per
// videos.list call covering up to 50 IDs). Replaces Firecrawl for YouTube URLs.
// ----------------------------------------------------------------------------
function parseYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const validId = (id: string | null | undefined): string | null =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;

  if (host === 'youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    return validId(seg);
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') return validId(parsed.searchParams.get('v'));
    const m = parsed.pathname.match(/^\/(embed|shorts|v|live)\/([^/?#]+)/);
    if (m) return validId(m[2]);
  }
  return null;
}

async function extractYouTubeDates(
  urlsToIds: Map<string, string>,
  apiKey: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = Array.from(new Set(urlsToIds.values()));
  if (ids.length === 0) return result;

  const idToDate = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.join(',')}&key=${apiKey}`;
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        console.warn(`YouTube API non-200 (${res.status}); falling through for ${chunk.length} IDs`);
        continue;
      }
      const data = await res.json();
      for (const item of data.items ?? []) {
        const id = item?.id;
        const publishedAt = item?.snippet?.publishedAt;
        const validated = publishedAt ? validateAndFormatDate(publishedAt) : null;
        if (id && validated) idToDate.set(id, validated);
      }
    } catch (err) {
      console.warn('YouTube API fetch error; falling through:', err);
    }
  }

  for (const [url, id] of urlsToIds) {
    const date = idToDate.get(id);
    if (date) result.set(url, date);
  }
  return result;
}

// ----------------------------------------------------------------------------
// Reddit JSON-endpoint extractor. Append .json to any public Reddit URL;
// returns full thread JSON including created_utc (Unix seconds). Free, no key,
// unauthenticated rate limit ~60 req/min. Cap concurrency to ~5 to stay under.
// ----------------------------------------------------------------------------
function isRedditUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'reddit.com' && host !== 'old.reddit.com' && host !== 'np.reddit.com' && host !== 'new.reddit.com') {
    return false;
  }
  // Only individual threads/comments have a useful created_utc. Skip subreddit
  // index pages and the homepage.
  return /\/comments\/[a-z0-9]+/i.test(parsed.pathname);
}

// Reddit blocks unauthenticated .json requests from data-center IPs (returns
// 403 from Supabase egress). OAuth via a "script" app bypasses that block and
// raises the rate limit to 600 req / 10 min.
const REDDIT_UA = 'perceptionx-recency/1.0 (by /u/Virtual_Composer_770)';

async function getRedditToken(): Promise<string | null> {
  const id = Deno.env.get('REDDIT_CLIENT_ID');
  const secret = Deno.env.get('REDDIT_CLIENT_SECRET');
  if (!id || !secret) {
    console.warn('Reddit OAuth: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set');
    return null;
  }
  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${id}:${secret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_UA,
      },
      // "client_credentials" doesn't work for script-type apps; they use
      // "https://oauth.reddit.com/grants/installed_client" or a password grant.
      // For script apps the documented grant is password, but Reddit also accepts
      // a synthetic "client_credentials"-style call for read-only access via the
      // installed_client grant with a device_id.
      body: 'grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=DO_NOT_TRACK_THIS_DEVICE',
    });
    if (!res.ok) {
      console.warn(`Reddit token fetch ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
      return null;
    }
    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.warn('Reddit token error:', err);
    return null;
  }
}

async function fetchRedditDate(url: string, token: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // OAuth endpoint uses oauth.reddit.com; same path with .json suffix.
  const jsonUrl = `https://oauth.reddit.com${parsed.pathname.replace(/\/$/, '')}.json`;
  try {
    const res = await fetch(jsonUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': REDDIT_UA,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      console.warn(`Reddit fetch ${res.status} for ${jsonUrl}`);
      return null;
    }
    const data = await res.json();
    const createdUtc = Array.isArray(data)
      ? data[0]?.data?.children?.[0]?.data?.created_utc
      : null;
    if (typeof createdUtc !== 'number') return null;
    const iso = new Date(createdUtc * 1000).toISOString();
    return validateAndFormatDate(iso);
  } catch (err) {
    console.warn(`Reddit fetch error for ${url}:`, err);
    return null;
  }
}

// Returns the resolved dates plus whether we actually held a token. Callers need
// the distinction: with a token, a missing date means the thread has none; with-
// out one, it means we never asked.
async function extractRedditDates(urls: string[]): Promise<{ dates: Map<string, string>; tokenOk: boolean }> {
  const result = new Map<string, string>();
  const token = await getRedditToken();
  if (!token) return { dates: result, tokenOk: false };
  const concurrency = 5;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      const date = await fetchRedditDate(url, token);
      if (date) result.set(url, date);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return { dates: result, tokenOk: true };
}

