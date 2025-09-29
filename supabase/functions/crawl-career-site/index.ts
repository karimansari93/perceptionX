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
    // Crawl the initial page and all career-related pages
    const crawlResults = await crawlCareerSite(url);
    
    // Extract all content from crawled pages
    const allContent = crawlResults.map(page => page.content).join('\n\n');
    
    // Extract metadata from the main page
    const metadata = crawlResults[0]?.metadata || {};
    
    // Get all crawled URLs with detailed information
    const crawledUrls = crawlResults.map(page => ({
      url: page.url,
      title: page.metadata.title || 'Untitled',
      status: page.status,
      contentLength: page.content.length,
      isCareerRelated: page.metadata.isCareerRelated || false,
      categoryScores: page.metadata.categoryScores || {}
    }));

    // Aggregate categorized content across all pages
    const aggregatedCategories = {
      'mission-purpose': { content: '', totalScore: 0, pageCount: 0 },
      'rewards-recognition': { content: '', totalScore: 0, pageCount: 0 },
      'company-culture': { content: '', totalScore: 0, pageCount: 0 },
      'social-impact': { content: '', totalScore: 0, pageCount: 0 },
      'inclusion': { content: '', totalScore: 0, pageCount: 0 },
      'innovation': { content: '', totalScore: 0, pageCount: 0 },
      'wellbeing-balance': { content: '', totalScore: 0, pageCount: 0 },
      'leadership': { content: '', totalScore: 0, pageCount: 0 },
      'security-perks': { content: '', totalScore: 0, pageCount: 0 },
      'career-opportunities': { content: '', totalScore: 0, pageCount: 0 }
    };

    // Aggregate content by category
    crawlResults.forEach(page => {
      if (page.metadata.categorizedContent) {
        Object.keys(aggregatedCategories).forEach(categoryId => {
          const categoryData = page.metadata.categorizedContent[categoryId];
          if (categoryData && categoryData.content) {
            aggregatedCategories[categoryId].content += categoryData.content + ' ';
            aggregatedCategories[categoryId].totalScore += categoryData.score;
            aggregatedCategories[categoryId].pageCount += 1;
          }
        });
      }
    });

    // Calculate average scores and clean up content
    Object.keys(aggregatedCategories).forEach(categoryId => {
      const category = aggregatedCategories[categoryId];
      category.averageScore = category.pageCount > 0 ? category.totalScore / category.pageCount : 0;
      category.content = category.content.trim();
    });
    // Try to store the crawl result in database (optional)
    try {
      const { error: dbError } = await supabaseClient.from('career_site_crawls').insert({
        user_id: userId,
        url: url,
        content: allContent,
        metadata: metadata,
        links: crawledUrls.map(u => u.url),
        crawled_urls: crawledUrls,
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
        content: allContent,
        metadata: metadata,
        links: crawledUrls.map(u => u.url),
        crawledUrls: crawledUrls,
        categorizedContent: aggregatedCategories,
        analysis: {
          totalPages: crawlResults.length,
          careerRelatedPages: crawlResults.filter(p => p.metadata.isCareerRelated).length,
          totalContentLength: allContent.length,
          topCategories: Object.keys(aggregatedCategories)
            .map(categoryId => ({
              categoryId,
              averageScore: aggregatedCategories[categoryId].averageScore,
              pageCount: aggregatedCategories[categoryId].pageCount,
              hasContent: aggregatedCategories[categoryId].content.length > 0
            }))
            .filter(cat => cat.hasContent)
            .sort((a, b) => b.averageScore - a.averageScore)
            .slice(0, 5)
        }
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

// Main function to crawl career site and all related pages
async function crawlCareerSite(initialUrl: string) {
  const visitedUrls = new Set<string>();
  const crawlResults: Array<{
    url: string;
    content: string;
    metadata: any;
    status: 'success' | 'error';
  }> = [];
  
  const baseUrl = new URL(initialUrl);
  const baseDomain = baseUrl.hostname;
  const baseOrigin = baseUrl.origin;
  
  // URL patterns to include (career-related paths)
  const includePatterns = [
    '/careers', '/career',
    '/life-at', '/life-at-',
    '/culture', '/values', '/mission',
    '/benefits', '/perks', '/compensation',
    '/diversity', '/inclusion', '/equity', '/dei',
    '/work-life', '/wellbeing', '/wellness',
    '/growth', '/development', '/learning', '/training',
    '/leadership', '/management',
    '/innovation', '/technology',
    '/social-impact', '/community', '/sustainability',
    '/people', '/working', '/employee', '/team',
    '/join', '/hiring', '/recruitment'
  ];
  
  // URL patterns to exclude
  const excludePatterns = [
    '/careers/job/', '/career/job/',
    '/apply', '/application',
    '/login', '/signin', '/register',
    '/privacy', '/terms', '/legal',
    '/blog/', '/news/', '/press/',
    '/contact', '/support'
  ];
  
  // Function to check if URL matches include patterns
  function matchesIncludePatterns(url: string): boolean {
    const urlPath = new URL(url).pathname.toLowerCase();
    return includePatterns.some(pattern => urlPath.includes(pattern.toLowerCase()));
  }
  
  // Function to check if URL matches exclude patterns
  function matchesExcludePatterns(url: string): boolean {
    const urlPath = new URL(url).pathname.toLowerCase();
    return excludePatterns.some(pattern => urlPath.includes(pattern.toLowerCase()));
  }
  
  // Function to check if a URL is career-related
  function isCareerRelated(url: string, title: string = '', content: string = ''): boolean {
    // First check URL patterns
    if (matchesIncludePatterns(url) && !matchesExcludePatterns(url)) {
      return true;
    }
    
    // Then check title and content for career keywords
    const careerKeywords = [
      'career', 'careers', 'job', 'jobs', 'hiring', 'employment', 'work', 'team',
      'culture', 'values', 'mission', 'purpose', 'benefits', 'perks', 'diversity',
      'inclusion', 'wellbeing', 'growth', 'development', 'leadership', 'innovation'
    ];
    
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();
    
    return careerKeywords.some(keyword => 
      urlLower.includes(keyword) || titleLower.includes(keyword) || contentLower.includes(keyword)
    );
  }

  // Function to categorize content by TalentX attributes
  function categorizeContent(content: string, url: string, title: string): any {
    const contentLower = content.toLowerCase();
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();
    
    const categories = {
      'mission-purpose': {
        keywords: ['mission', 'purpose', 'values', 'vision', 'meaningful', 'impact', 'change the world', 'make a difference'],
        content: '',
        score: 0
      },
      'rewards-recognition': {
        keywords: ['salary', 'compensation', 'benefits', 'bonus', 'recognition', 'rewards', 'incentives', 'perks'],
        content: '',
        score: 0
      },
      'company-culture': {
        keywords: ['culture', 'workplace', 'environment', 'atmosphere', 'values', 'team', 'collaboration', 'fun'],
        content: '',
        score: 0
      },
      'social-impact': {
        keywords: ['social impact', 'community', 'charity', 'volunteering', 'sustainability', 'environmental', 'giving back'],
        content: '',
        score: 0
      },
      'inclusion': {
        keywords: ['diversity', 'inclusion', 'equity', 'DEI', 'minority', 'women', 'LGBTQ', 'accessible'],
        content: '',
        score: 0
      },
      'innovation': {
        keywords: ['innovation', 'innovative', 'technology', 'cutting-edge', 'research', 'development', 'breakthrough'],
        content: '',
        score: 0
      },
      'wellbeing-balance': {
        keywords: ['work-life balance', 'wellbeing', 'wellness', 'flexible', 'remote', 'mental health', 'stress'],
        content: '',
        score: 0
      },
      'leadership': {
        keywords: ['leadership', 'management', 'executives', 'CEO', 'directors', 'managers', 'decision-making'],
        content: '',
        score: 0
      },
      'security-perks': {
        keywords: ['job security', 'stability', 'perks', 'amenities', 'office', 'food', 'gym', 'transportation'],
        content: '',
        score: 0
      },
      'career-opportunities': {
        keywords: ['career', 'growth', 'development', 'advancement', 'promotion', 'learning', 'training', 'mentorship'],
        content: '',
        score: 0
      }
    };

    // Extract relevant content for each category
    Object.keys(categories).forEach(categoryId => {
      const category = categories[categoryId];
      const matchingKeywords = category.keywords.filter(keyword => 
        contentLower.includes(keyword.toLowerCase()) || 
        urlLower.includes(keyword.toLowerCase()) || 
        titleLower.includes(keyword.toLowerCase())
      );
      
      if (matchingKeywords.length > 0) {
        // Extract sentences containing relevant keywords
        const sentences = content.split(/[.!?]+/).filter(sentence => 
          category.keywords.some(keyword => 
            sentence.toLowerCase().includes(keyword.toLowerCase())
          )
        );
        
        category.content = sentences.join('. ').trim();
        category.score = Math.min(matchingKeywords.length * 10, 100); // Score based on keyword matches
      }
    });

    return categories;
  }
  
  // Function to crawl a single page with depth control
  async function crawlPage(url: string, depth: number = 0, maxDepth: number = 3) {
    if (visitedUrls.has(url) || depth > maxDepth) return;
    visitedUrls.add(url);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        crawlResults.push({
          url,
          content: '',
          metadata: { title: 'Error', description: `Failed to fetch: ${response.status}` },
          status: 'error'
        });
        return;
      }
      
      const html = await response.text();
      const content = extractTextFromHTML(html);
      const metadata = extractMetadata(html, url);
      const links = extractLinks(html, url);
      
      // Check if this page is career-related
      const isCareer = isCareerRelated(url, metadata.title, content);
      
      // Categorize content by TalentX attributes
      const categorizedContent = categorizeContent(content, url, metadata.title);
      
      crawlResults.push({
        url,
        content,
        metadata: {
          ...metadata,
          categorizedContent,
          isCareerRelated: isCareer,
          contentLength: content.length,
          depth: depth,
          categoryScores: Object.keys(categorizedContent).reduce((acc, key) => {
            acc[key] = categorizedContent[key].score;
            return acc;
          }, {} as any)
        },
        status: 'success'
      });
      
      // If this is a career-related page and we haven't reached max depth, crawl its links
      if (isCareer && depth < maxDepth) {
        const careerLinks = links.filter(link => {
          try {
            const linkUrl = new URL(link);
            // Only crawl links from the same domain
            if (linkUrl.hostname !== baseDomain) return false;
            
            // Check if already visited
            if (visitedUrls.has(link)) return false;
            
            // Check if URL matches include patterns and doesn't match exclude patterns
            return matchesIncludePatterns(link) && !matchesExcludePatterns(link);
          } catch (e) {
            return false;
          }
        });
        
        // Crawl career-related links in parallel (with some concurrency limit)
        const crawlPromises = careerLinks.slice(0, 10).map(link => 
          crawlPage(link, depth + 1, maxDepth)
        );
        
        await Promise.all(crawlPromises);
      }
      
    } catch (error) {
      console.error(`Error crawling ${url}:`, error);
      crawlResults.push({
        url,
        content: '',
        metadata: { title: 'Error', description: error.message },
        status: 'error'
      });
    }
  }
  
  // Function to discover URLs from sitemap
  async function discoverFromSitemap() {
    try {
      const sitemapUrl = `${baseOrigin}/sitemap.xml`;
      const response = await fetch(sitemapUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (response.ok) {
        const sitemapContent = await response.text();
        const urlRegex = /<loc>(.*?)<\/loc>/g;
        let match;
        const sitemapUrls = [];
        
        while ((match = urlRegex.exec(sitemapContent)) !== null) {
          const url = match[1];
          if (matchesIncludePatterns(url) && !matchesExcludePatterns(url)) {
            sitemapUrls.push(url);
          }
        }
        
        // Add sitemap URLs to crawl queue
        for (const url of sitemapUrls.slice(0, 20)) { // Limit to 20 sitemap URLs
          if (!visitedUrls.has(url)) {
            await crawlPage(url, 0, 2); // Lower depth for sitemap URLs
          }
        }
      }
    } catch (error) {
      console.log('Sitemap not found or error accessing:', error.message);
    }
  }
  
  // Start crawling from the initial URL
  await crawlPage(initialUrl, 0, 3);
  
  // Also try to discover URLs from sitemap
  await discoverFromSitemap();
  
  return crawlResults;
}

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
  const baseUrlObj = new URL(baseUrl);
  const baseOrigin = baseUrlObj.origin;
  
  // Extract all <a> tags with href attributes
  const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>/gi;
  let match;
  
  while((match = linkRegex.exec(html)) !== null){
    const href = match[1];
    
    // Skip anchors, javascript, mailto, tel, etc.
    if (!href || 
        href.startsWith('#') || 
        href.startsWith('javascript:') || 
        href.startsWith('mailto:') || 
        href.startsWith('tel:') ||
        href.startsWith('data:')) {
      continue;
    }
    
    try {
      let absoluteUrl;
      
      // Handle relative URLs
      if (href.startsWith('/')) {
        // Root-relative URL
        absoluteUrl = new URL(href, baseOrigin).href;
      } else if (href.startsWith('http://') || href.startsWith('https://')) {
        // Absolute URL
        absoluteUrl = href;
      } else {
        // Relative URL
        absoluteUrl = new URL(href, baseUrl).href;
      }
      
      // Only include URLs from the same domain
      const linkUrl = new URL(absoluteUrl);
      if (linkUrl.hostname === baseUrlObj.hostname) {
        links.push(absoluteUrl);
      }
    } catch (e) {
      // Skip invalid URLs
      continue;
    }
  }
  
  // Remove duplicates and return unique links
  return [...new Set(links)];
}
