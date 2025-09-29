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
  extractionMethod: 'url-pattern' | 'firecrawl-json' | 'firecrawl-html' | 'not-found';
  sourceType?: 'perplexity' | 'google-ai-overviews' | 'search-results';
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
    
    for (const citation of citations) {
      const result = await extractRecencyScore(citation, firecrawlApiKey, testMode);
      results.push(result);
      
      // Add delay to avoid rate limits
      if (!testMode) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        summary: {
          total: results.length,
          withDates: results.filter(r => r.recencyScore !== null).length,
          withoutDates: results.filter(r => r.recencyScore === null).length
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
  testMode: boolean
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

  // Method 2: Try Firecrawl JSON extraction (if not in test mode and API key available)
  if (!testMode && firecrawlApiKey) {
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
    }
  }

  // Method 3: Try Firecrawl HTML scraping (if not in test mode and API key available)
  if (!testMode && firecrawlApiKey) {
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
    // Month DD, YYYY
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i
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
      } else if (pattern === patterns[3]) { // Month DD, YYYY
        const [, month, day, year] = match;
        const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
        return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
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
          prompt: 'Extract the publication date of this article. Look for date patterns like "Published on", "Date:", or in meta tags. Return only the date in YYYY-MM-DD format, or null if no date is found.'
        }],
        onlyMainContent: true
      })
    });

    if (!response.ok) {
      console.log(`Firecrawl API error: ${response.status}`);
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
        formats: ['html'],
        onlyMainContent: true
      })
    });

    if (!response.ok) {
      throw new Error(`Firecrawl API error: ${response.status}`);
    }

    const data = await response.json();
    const html = data.data?.html;
    
    if (!html) return null;

    // Look for common date patterns in HTML
    const datePatterns = [
      /<time[^>]*datetime="([^"]*)"[^>]*>/i,
      /<meta[^>]*property="article:published_time"[^>]*content="([^"]*)"[^>]*>/i,
      /<meta[^>]*name="date"[^>]*content="([^"]*)"[^>]*>/i,
      /<meta[^>]*name="pubdate"[^>]*content="([^"]*)"[^>]*>/i,
      /<meta[^>]*property="og:published_time"[^>]*content="([^"]*)"[^>]*>/i
    ];

    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        const dateStr = match[1];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
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

function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

