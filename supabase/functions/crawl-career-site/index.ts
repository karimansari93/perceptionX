import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { url, userId, options = {} } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({
        success: false,
        error: 'URL is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!userId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'User ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate URL
    try {
      new URL(url);
    } catch  {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid URL format'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    // For now, let's implement a basic web scraping approach
    // We'll use fetch to get the page content and extract text
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    // Extract text content from HTML
    const textContent = extractTextFromHTML(html);
    // Extract metadata
    const metadata = extractMetadata(html, url);
    // Extract links (for future enhancement)
    const links = extractLinks(html, url);
    // Try to store the crawl result in database (optional)
    try {
      const { error: dbError } = await supabaseClient.from('career_site_crawls').insert({
        user_id: userId,
        url: url,
        content: textContent,
        metadata: metadata,
        links: links,
        created_at: new Date().toISOString()
      });
      if (dbError) {
        console.error('Database error:', dbError);
      // Continue even if database storage fails
      }
    } catch (dbError) {
      console.error('Database operation failed:', dbError);
    // Continue even if database storage fails
    }
    return new Response(JSON.stringify({
      success: true,
      data: {
        content: textContent,
        metadata: metadata,
        links: links
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
function extractTextFromHTML(html) {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Remove extra whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}
function extractMetadata(html, baseUrl) {
  const metadata = {
    url: baseUrl,
    title: '',
    description: ''
  };
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    metadata.title = titleMatch[1].trim();
  }
  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  if (descMatch) {
    metadata.description = descMatch[1].trim();
  }
  // Extract meta keywords
  const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)["']/i);
  if (keywordsMatch) {
    metadata.keywords = keywordsMatch[1].trim();
  }
  return metadata;
}
function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>/gi;
  let match;
  while((match = linkRegex.exec(html)) !== null){
    const href = match[1];
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        if (absoluteUrl.startsWith(baseUrl)) {
          links.push(absoluteUrl);
        }
      } catch  {
      // Skip invalid URLs
      }
    }
  }
  // Remove duplicates and return unique links
  return [
    ...new Set(links)
  ];
}
