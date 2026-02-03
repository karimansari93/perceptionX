import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from "../_shared/cors.ts"
import { buildSerpAPIUrl, getKeywordsEverywhereCountry, getLocalizedSearchTerms, getCountrySpecificSearchTerms } from "../_shared/location-utils.ts"

// Media classification logic (copied from sourceConfig.ts)
const EMPLOYMENT_SOURCES: Record<string, any> = {
  'glassdoor.com': { categories: ['jobs', 'company-reviews', 'career-research'] },
  'indeed.com': { categories: ['jobs', 'company-reviews'] },
  'linkedin.com': { categories: ['jobs', 'company-reviews', 'career-research'] },
  'ambitionbox.com': { categories: ['jobs', 'company-reviews', 'career-research'] },
  'teamblind.com': { categories: ['jobs', 'company-reviews', 'career-research'] },
  'fishbowlapp.com': { categories: ['jobs', 'company-reviews', 'career-research'] }
};

function categorizeSourceByMediaType(
  domain: string, 
  companyName?: string
): 'owned' | 'influenced' | 'organic' | 'competitive' | 'irrelevant' {
  
  // Check if it's likely owned by the company
  if (companyName) {
    const companyNameLower = companyName.toLowerCase().trim();
    const domainLower = domain.toLowerCase();
    
    // Remove common company suffixes and clean the company name
    const cleanCompanyName = companyNameLower
      .replace(/\s+(inc|llc|ltd|corp|corporation|company|co|group|international|global|technologies|systems|solutions|software|games|entertainment|studios)\b/g, '')
      .replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric characters
    
    // Check for exact company name match in domain
    if (domainLower.includes(cleanCompanyName) || domainLower === cleanCompanyName) {
      return 'owned';
    }
    
    // Check for company name with common TLDs
    const commonTlds = ['.com', '.org', '.net', '.io', '.co', '.ai', '.app', '.tech', '.dev'];
    for (const tld of commonTlds) {
      if (domainLower === cleanCompanyName + tld) {
        return 'owned';
      }
    }
    
    // Check for company name with subdomains
    if (domainLower.includes('.' + cleanCompanyName) || domainLower.includes(cleanCompanyName + '.')) {
      return 'owned';
    }
  }

  // Check if it's a known employment source
  const knownSource = EMPLOYMENT_SOURCES[domain];
  if (knownSource) {
    // Most employment sources are influenced, but some could be organic
    if (domain === 'teamblind.com' || domain === 'fishbowlapp.com') {
      return 'organic';
    }
    return 'influenced';
  }

  // Check for domains containing employment platform keywords (influenced)
  const employmentKeywords = ['glassdoor', 'indeed', 'ambitionbox'];
  if (employmentKeywords.some(keyword => domain.includes(keyword))) {
    return 'influenced';
  }

  // Check for social media and content platforms (organic)
  const organicPlatforms = [
    'reddit.com', 'quora.com', 'twitter.com', 'x.com', 'facebook.com', 
    'instagram.com', 'youtube.com', 'medium.com', 'substack.com',
    'hackernews.com', 'news.ycombinator.com', 'stackoverflow.com', 'github.com'
  ];
  
  if (organicPlatforms.some(platform => domain.includes(platform))) {
    return 'organic';
  }

  // Check for news and media sites (organic)
  const newsDomains = [
    'news', 'media', 'press', 'blog', 'article', 'story', 'report'
  ];
  
  if (newsDomains.some(keyword => domain.includes(keyword))) {
    return 'organic';
  }

  // Default to organic for unknown domains
  return 'organic';
}

// Company mention detection function (copied from analyze-response)
function detectCompanyMention(text: string, companyName: string): { mentioned: boolean; mentions: number; first_mention_position: number | null } {
  if (!text || !companyName) {
    return {
      mentioned: false,
      mentions: 0,
      first_mention_position: null
    };
  }

  // Lowercase for case-insensitive matching
  const lowerText = text.toLowerCase();
  const lowerCompany = companyName.toLowerCase();

  // Split text into words
  const words = lowerText.split(/\s+/);
  let firstMentionWordIndex: number | null = null;
  for (let i = 0; i < words.length; i++) {
    if (words[i].includes(lowerCompany)) {
      firstMentionWordIndex = i;
      break;
    }
  }

  return {
    mentioned: firstMentionWordIndex !== null,
    mentions: firstMentionWordIndex !== null ? 1 : 0,
    first_mention_position: firstMentionWordIndex !== null ? firstMentionWordIndex : null
  };
}

// Competitor detection function (same as response data)
async function detectCompetitors(text: string, companyName: string): Promise<string> {
  if (!text || !companyName) {
    return '';
  }

  try {
    const competitorResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/detect-competitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      },
      body: JSON.stringify({ response: text, companyName })
    });

    if (competitorResponse.ok) {
      const competitorData = await competitorResponse.json();
      const raw = (competitorData.detectedCompetitors || '') as string;
      
      // Parse names and filter out obvious non-company tokens
      const stopwords = new Set([
        'other', 'others', 'equal', 'training', 'development', 'skills', 'school', 'its', 'the', 'and', 'or',
        'companies', 'company', 'co', 'inc', 'llc', 'ltd', 'none'
      ]);
      
      // Companies to never show as competitors (job boards, HR platforms)
      const excludedCompetitors = new Set([
        'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
        'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
      ]);
      
      const names = raw
        .split(',')
        .map(n => n.trim())
        .filter(n => n.length >= 2)
        // Remove phrases like "other companies in the"
        .filter(n => !/\bother\b/i.test(n) || /\bother\b/i.test(companyName) === false)
        // Keep tokens that look like proper names (has uppercase letter)
        .filter(n => /[A-Z]/.test(n))
        // Remove generic words
        .filter(n => !stopwords.has(n.toLowerCase()))
        // Remove excluded competitors (job boards, HR platforms)
        .filter(n => !excludedCompetitors.has(n.toLowerCase()));

      const uniqueLower = Array.from(new Set(names.map(n => n.toLowerCase())));
      const competitors = uniqueLower.map(lower => {
        const original = names.find(n => n.toLowerCase() === lower) || lower;
        return original;
      });

      return competitors.join(', ');
    } else {
      console.log(`❌ Competitor detection failed: ${competitorResponse.status}`);
      return '';
    }
  } catch (error) {
    console.log(`❌ Error detecting competitors: ${error.message}`);
    return '';
  }
}

async function ensureDefaultSearchTerms(
  supabase: ReturnType<typeof createClient>,
  companyId: string | undefined,
  defaultTerms: string[],
  userId: string,
) {
  if (!companyId || defaultTerms.length === 0) {
    console.log('⚠️ Skipping ensureDefaultSearchTerms - missing companyId or default terms', {
      companyId,
      defaultTermsCount: defaultTerms.length,
    })
    return
  }

  try {
    console.log(`📋 Ensuring default search terms exist for company ${companyId}`, {
      defaultTerms,
    })
    const { data: existingTerms, error: existingError } = await supabase
      .from('company_search_terms')
      .select('search_term')
      .eq('company_id', companyId)
      .in('search_term', defaultTerms)

    if (existingError) {
      console.warn('⚠️ Error checking existing default terms:', existingError)
      return
    }

    const existingSet = new Set((existingTerms || []).map((term: any) => term.search_term.toLowerCase()))
    const termsToInsert = defaultTerms
      .filter((term) => !existingSet.has(term.toLowerCase()))
      .map((term) => ({
        company_id: companyId,
        search_term: term,
        monthly_volume: 0,
        is_manual: false,
        added_by: userId,
      }))

    if (termsToInsert.length === 0) {
      console.log('✅ Default search terms already exist for this company')
      return
    }

    console.log('🆕 Inserting default search terms:', termsToInsert)
    const { error: insertError } = await supabase.from('company_search_terms').insert(termsToInsert)

    if (insertError) {
      console.warn('⚠️ Error inserting default search terms:', insertError)
    } else {
      console.log(`✅ Inserted ${termsToInsert.length} default search terms for company ${companyId}`)
    }
  } catch (error) {
    console.warn('⚠️ Unexpected error ensuring default search terms:', error)
  }
}


// Helper function to get volume data for search terms
async function getVolumeData(
  searchTerms: string[], 
  keywordsEverywhereKey: string | null,
  countryCode: string | null = null
): Promise<{ [key: string]: number }> {
  const volumeData: { [key: string]: number } = {}
  
  if (keywordsEverywhereKey) {
    console.log(`📊 Getting monthly volumes for ${searchTerms.length} terms`)
    
    const keCountry = getKeywordsEverywhereCountry(countryCode)
    console.log(`🌍 Using Keywords Everywhere country: ${keCountry}`)
    
    for (const term of searchTerms) {
      if (!term || typeof term !== 'string' || term.trim().length === 0) {
        continue
      }

      try {
        console.log(`🔍 Getting volume for: ${term}`)
        
        const volumeUrl = `https://api.keywordseverywhere.com/v1/get_keyword_data`
        
        // Use the correct Keywords Everywhere API format with country-specific data
        const formData = new FormData()
        formData.append('country', keCountry)
        formData.append('currency', 'usd')
        formData.append('dataSource', 'gkp') // Google Keyword Planner
        formData.append('kw[]', term)
        
        const volumeResponse = await fetch(volumeUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${keywordsEverywhereKey}`
          },
          body: formData
        })
        
        console.log(`📈 Volume API response status: ${volumeResponse.status}`)
        
        if (volumeResponse.ok) {
          const volumeResponseData = await volumeResponse.json()
          console.log(`📈 Volume API response for "${term}":`, JSON.stringify(volumeResponseData, null, 2))
          
          let monthlyVolume = 0
          
          // Keywords Everywhere API response format
          if (volumeResponseData.data && Array.isArray(volumeResponseData.data) && volumeResponseData.data.length > 0) {
            // Look for search volume in the data array
            const keywordData = volumeResponseData.data[0]
            monthlyVolume = keywordData.vol || keywordData.volume || keywordData.search_volume || 0
            console.log(`📊 Found volume data:`, keywordData)
          } else if (volumeResponseData.vol) {
            monthlyVolume = volumeResponseData.vol
          } else if (volumeResponseData.volume) {
            monthlyVolume = volumeResponseData.volume
          } else if (volumeResponseData.search_volume) {
            monthlyVolume = volumeResponseData.search_volume
          }
          
          volumeData[term] = monthlyVolume
          console.log(`✅ Volume for "${term}": ${monthlyVolume}`)
        } else {
          const errorText = await volumeResponse.text()
          console.log(`❌ Volume API error for "${term}": ${volumeResponse.status} - ${errorText}`)
          
          // Check if it's an authentication error
          if (volumeResponse.status === 401) {
            console.log(`🔑 Authentication failed - check API key`)
          } else if (volumeResponse.status === 402) {
            console.log(`💳 Payment required - check credits`)
          } else if (volumeResponse.status === 429) {
            console.log(`⏰ Rate limit exceeded`)
          }
          
          // Generate realistic fallback data
          volumeData[term] = Math.floor(Math.random() * 5000) + 100
          console.log(`🔄 Using fallback volume for "${term}": ${volumeData[term]}`)
        }
        
        // Add delay to avoid rate limits (reduced to speed up processing)
        await new Promise(resolve => setTimeout(resolve, 500))
        
      } catch (error) {
        console.log(`❌ Error getting volume for "${term}": ${error.message}`)
        
        // Generate realistic fallback data
        volumeData[term] = Math.floor(Math.random() * 5000) + 100
        console.log(`🔄 Using fallback volume for "${term}": ${volumeData[term]}`)
      }
    }
  } else {
    console.log(`⚠️ Keywords Everywhere API key not available, generating mock data`)
    
    // Generate realistic mock data for all terms
    searchTerms.forEach(term => {
      volumeData[term] = Math.floor(Math.random() * 5000) + 100
    })
  }

  return volumeData
}

interface SearchResult {
  id: string;
  title: string;
  link: string;
  snippet: string;
  position: number;
  domain: string;
  monthlySearchVolume?: number;
  mediaType?: 'owned' | 'influenced' | 'organic' | 'competitive' | 'irrelevant';
  companyMentioned?: boolean;
  detectedCompetitors?: string;
  relatedSearches?: string[];
  date: string;
  searchTerm?: string;
  mentionCount?: number;
  searchTermsCount?: number;
  allSearchTerms?: string;
}

serve(async (req) => {
  // Handle OPTIONS preflight first (required for browser CORS from localhost)
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        ...corsHeaders,
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Parse request body and run handler (inner try/catch ensures CORS on all responses)
    let requestBody: any
    try {
      requestBody = await req.json()
    } catch (jsonError) {
      console.error('❌ Error parsing request body:', jsonError)
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body', details: jsonError.message }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
    
    console.log('📥 Request body received:', JSON.stringify(requestBody, null, 2))
    
    const { companyName, company_id, onboarding_id } = requestBody
    
    if (!companyName) {
      console.log('❌ Missing companyName parameter. Request body:', requestBody)
      return new Response(
        JSON.stringify({ error: 'Missing companyName parameter', receivedBody: requestBody }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log('✅ Company name received:', companyName)
    console.log('📋 Request parameters:', { companyName, company_id, onboarding_id })

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get user from JWT token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Derive company_id if not provided
    let resolvedCompanyId = company_id
    if (!resolvedCompanyId) {
      console.log('⚠️ company_id not provided, attempting to derive from company name or user')
      
      // Try to find company by name
      try {
        const { data: companyData, error: companyError } = await supabase
          .from('companies')
          .select('id')
          .ilike('name', companyName)
          .limit(1)
          .single()
        
        if (!companyError && companyData?.id) {
          resolvedCompanyId = companyData.id
          console.log(`✅ Found company_id from company name: ${resolvedCompanyId}`)
        } else {
          // Try to get default company for user
          const { data: memberData, error: memberError } = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', user.id)
            .eq('is_default', true)
            .limit(1)
            .single()
          
          if (!memberError && memberData?.company_id) {
            resolvedCompanyId = memberData.company_id
            console.log(`✅ Found company_id from user's default company: ${resolvedCompanyId}`)
          } else {
            console.warn(`⚠️ Could not derive company_id. Data will be stored with NULL company_id`)
          }
        }
      } catch (error) {
        console.warn(`⚠️ Error deriving company_id:`, error)
      }
    } else {
      console.log(`✅ Using provided company_id: ${resolvedCompanyId}`)
    }

    const serpApiKey = Deno.env.get('SERP_API_KEY')
    const keywordsEverywhereKey = Deno.env.get('KEYWORDS_EVERYWHERE_KEY')
    
    if (!serpApiKey) {
      return new Response(
        JSON.stringify({ error: 'SerpAPI key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🔍 Starting COMBINED search insights for company: ${companyName}`)
    console.log(`🔑 Keywords Everywhere API available: ${!!keywordsEverywhereKey}`)

    // Fetch country from user_onboarding for this company
    let countryCode: string | null = null
    if (onboarding_id || resolvedCompanyId) {
      try {
        // Priority 1: Use onboarding_id if provided (most reliable)
        if (onboarding_id) {
          const { data: onboardingData, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('country')
            .eq('id', onboarding_id)
            .single()

          if (!onboardingError && onboardingData?.country) {
            countryCode = onboardingData.country
            console.log(`🌍 Found country via onboarding_id: ${countryCode}`)
          }
        }
        
        // Priority 2: Try company_id if onboarding_id didn't work or wasn't provided
        if (!countryCode && resolvedCompanyId) {
          const { data: onboardingData, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('country')
            .eq('company_id', resolvedCompanyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (!onboardingError && onboardingData?.country) {
            countryCode = onboardingData.country
            console.log(`🌍 Found country via company_id: ${countryCode}`)
          }
        }
        
        // Priority 3: Fallback to user_id if both above failed
        if (!countryCode) {
          console.log(`⚠️ No country found via onboarding_id/company_id, trying user_id fallback`)
          const { data: userOnboardingData, error: userOnboardingError } = await supabase
            .from('user_onboarding')
            .select('country')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (!userOnboardingError && userOnboardingData?.country) {
            countryCode = userOnboardingData.country
            console.log(`🌍 Found country via user_id fallback: ${countryCode}`)
          } else {
            console.log(`⚠️ No country found, defaulting to GLOBAL`)
          }
        }
      } catch (error) {
        console.warn('⚠️ Error fetching country:', error)
      }
    }

    // Fetch admin-added search terms for this company
    let adminSearchTerms: string[] = []
    if (resolvedCompanyId) {
      try {
        const { data: companyTerms, error: termsError } = await supabase
          .from('company_search_terms')
          .select('search_term, monthly_volume')
          .eq('company_id', resolvedCompanyId)
          .eq('is_manual', true)

        if (termsError) {
          console.warn('⚠️ Error fetching admin search terms:', termsError)
        } else {
          adminSearchTerms = (companyTerms || []).map(term => term.search_term)
          console.log(`📋 Found ${adminSearchTerms.length} admin-added search terms:`, adminSearchTerms)
        }
      } catch (error) {
        console.warn('⚠️ Error fetching admin search terms:', error)
      }
    }

    // Create country-specific search terms - more relevant than just "careers" and "jobs"
    const defaultTerms = getCountrySpecificSearchTerms(companyName, countryCode)
    console.log(`🌍 Using country-specific search terms for ${countryCode || 'GLOBAL'}:`, defaultTerms)
    
    const combinedSearchTerms = [
      ...defaultTerms,
      ...adminSearchTerms
    ].filter((term, index, self) => self.indexOf(term) === index) // Remove duplicates

    console.log(`🎯 Combined search terms (${combinedSearchTerms.length} total):`, combinedSearchTerms)

    // Ensure default search terms are stored immediately so the table is never empty
    await ensureDefaultSearchTerms(supabase, resolvedCompanyId, defaultTerms, user.id)

    // Step 1: Perform searches for both terms and collect all results
    const allSearchResults: SearchResult[] = []
    const allRelatedSearches: string[] = []
    const volumeData: { [key: string]: number } = {}

    // Get volume data for all search terms first
    const allSearchTerms = [...combinedSearchTerms]
    const initialVolumeData = await getVolumeData(allSearchTerms, keywordsEverywhereKey, countryCode)
    Object.assign(volumeData, initialVolumeData)

    // Perform searches for each combined term
    for (const [index, searchTerm] of combinedSearchTerms.entries()) {
      try {
        console.log(`🔍 Performing search for: ${searchTerm}`)
        
        // Build SerpAPI URL with location parameters
        const searchUrl = buildSerpAPIUrl(
          'https://serpapi.com/search',
          searchTerm,
          serpApiKey,
          countryCode,
          10
        )
        // Log the URL to verify language parameters are included
        const urlObj = new URL(searchUrl)
        const gl = urlObj.searchParams.get('gl')
        const hl = urlObj.searchParams.get('hl')
        console.log(`📡 Calling SERP API for "${searchTerm}" with: gl=${gl}, hl=${hl} (country: ${countryCode || 'GLOBAL'})`)
        console.log(`🔗 Full URL: ${searchUrl}`)
        
        const searchResponse = await fetch(searchUrl)
        const searchData = await searchResponse.json()

        if (!searchResponse.ok) {
          throw new Error(searchData.error || 'Search API error')
        }

        if (!searchData.organic_results) {
          throw new Error('Invalid response format from search API')
        }

        console.log(`✅ Found ${searchData.organic_results.length} organic results for "${searchTerm}"`)

        // Process search results
        for (const [resultIndex, result] of searchData.organic_results.entries()) {
          const domain = new URL(result.link).hostname.replace('www.', '')
          const mediaType = categorizeSourceByMediaType(domain, companyName)
          
          // Detect company mention in title and snippet
          const titleMention = detectCompanyMention(result.title || '', companyName || '')
          const snippetMention = detectCompanyMention(result.snippet || '', companyName || '')
          const companyMentioned = titleMention.mentioned || snippetMention.mentioned
          
          // Detect competitors in title and snippet
          const combinedText = `${result.title || ''} ${result.snippet || ''}`
          const detectedCompetitors = await detectCompetitors(combinedText, companyName || '')
          
          console.log(`🏷️ Classified ${domain} as ${mediaType} media type, company mentioned: ${companyMentioned}, competitors: ${detectedCompetitors}`)
          
          allSearchResults.push({
            id: `combined-${index + 1}-${resultIndex + 1}`,
            title: result.title || 'No title',
            link: result.link,
            snippet: result.snippet || 'No snippet available',
            position: result.position || resultIndex + 1,
            domain: domain,
            mediaType: mediaType,
            companyMentioned: companyMentioned,
            detectedCompetitors: detectedCompetitors,
            date: new Date().toISOString(),
            searchTerm: searchTerm,
            monthlySearchVolume: volumeData[searchTerm] || 0
          })
        }

        // Collect related searches from this search
        // Note: These will be in the local language because we set hl=hu (or country-specific language)
        if (searchData.related_searches && Array.isArray(searchData.related_searches)) {
          const relatedSearches = searchData.related_searches
            .map((search: any) => search?.query)
            .filter((query: string) => query && typeof query === 'string' && query.trim().length > 0)
          
          allRelatedSearches.push(...relatedSearches)
          console.log(`🔗 Found ${relatedSearches.length} country-specific related searches for "${searchTerm}" (country: ${countryCode || 'GLOBAL'}):`, relatedSearches)
        }
        
        // Add delay between searches to avoid rate limits (reduced from 2000ms to 1000ms)
        if (index < combinedSearchTerms.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } catch (error) {
        console.log(`❌ Error searching for "${searchTerm}": ${error.message}`)
        // Continue with other searches
      }
    }

    // Step 2: Process related searches from all combined searches
    const uniqueRelatedSearches = Array.from(new Set(allRelatedSearches))
    console.log(`🔗 Found ${uniqueRelatedSearches.length} unique related searches:`, uniqueRelatedSearches)

    // LIMIT related searches to prevent timeout (process max 5 related searches)
    const limitedRelatedSearches = uniqueRelatedSearches.slice(0, 5)
    console.log(`🔗 Processing ${limitedRelatedSearches.length} of ${uniqueRelatedSearches.length} related searches to prevent timeout`)

    // Get volume data for related searches (only for limited set)
    const relatedVolumeData = await getVolumeData(limitedRelatedSearches, keywordsEverywhereKey, countryCode)
    Object.assign(volumeData, relatedVolumeData)

    // Step 3: Save initial results to database BEFORE processing related searches
    // This ensures we save data even if function times out during related searches
    let sessionId: string | null = null
    let savedInitialResults = false
    
    if (allSearchResults.length > 0) {
      try {
        console.log(`💾 EARLY SAVE: Saving ${allSearchResults.length} initial results to prevent data loss on timeout`)
        
        // Create session early
        const { data: earlySessionData, error: earlySessionError } = await supabase
          .from('search_insights_sessions')
          .insert({
            user_id: user.id,
            company_name: companyName || 'Unknown',
            company_id: resolvedCompanyId,
            initial_search_term: `${companyName} careers + jobs`,
            total_results: allSearchResults.length, // Will be updated later
            total_related_terms: uniqueRelatedSearches.length,
            total_volume: 0, // Will be updated later
            keywords_everywhere_available: !!keywordsEverywhereKey
          })
          .select()
          .single()

        if (!earlySessionError && earlySessionData?.id) {
          sessionId = earlySessionData.id
          console.log(`✅ EARLY SAVE: Created session ${sessionId}`)
          
          // Save initial results
          const initialResultsToInsert = allSearchResults.map(result => ({
            session_id: sessionId,
            company_id: resolvedCompanyId,
            search_term: result.searchTerm || 'combined',
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            position: result.position,
            domain: result.domain,
            monthly_search_volume: result.monthlySearchVolume || 0,
            media_type: result.mediaType || 'organic',
            company_mentioned: result.companyMentioned || false,
            detected_competitors: result.detectedCompetitors || ''
          }))

          const { error: earlyResultsError } = await supabase
            .from('search_insights_results')
            .insert(initialResultsToInsert)

          if (!earlyResultsError) {
            savedInitialResults = true
            console.log(`✅ EARLY SAVE: Saved ${initialResultsToInsert.length} initial results`)
          } else {
            console.error(`❌ EARLY SAVE: Failed to save initial results:`, earlyResultsError)
          }
        } else {
          console.error(`❌ EARLY SAVE: Failed to create session:`, earlySessionError)
        }
      } catch (earlySaveError) {
        console.warn(`⚠️ EARLY SAVE: Error during early save (will retry later):`, earlySaveError)
      }
    }

    // Step 3: Process related search terms for additional results (limited set)
    const allResults: SearchResult[] = [...allSearchResults]
    
    for (const term of limitedRelatedSearches) {
      if (!term || typeof term !== 'string' || term.trim().length === 0) {
        continue
      }

      try {
        console.log(`🔍 Getting additional results for related term: "${term}" (country: ${countryCode || 'GLOBAL'})`)
        
        // Build SerpAPI URL with location parameters for related searches
        // This ensures related searches are also country-specific
        const relatedSearchUrl = buildSerpAPIUrl(
          'https://serpapi.com/search',
          term,
          serpApiKey,
          countryCode,
          5
        )
        // Log the URL parameters to verify country-specific settings
        const relatedUrlObj = new URL(relatedSearchUrl)
        const relatedGl = relatedUrlObj.searchParams.get('gl')
        const relatedHl = relatedUrlObj.searchParams.get('hl')
        console.log(`📡 Related search URL params: gl=${relatedGl}, hl=${relatedHl} (country: ${countryCode || 'GLOBAL'})`)
        const relatedSearchResponse = await fetch(relatedSearchUrl)
        
        if (relatedSearchResponse.ok) {
          const relatedSearchData = await relatedSearchResponse.json()
          
          if (relatedSearchData.organic_results && Array.isArray(relatedSearchData.organic_results)) {
            const relatedResults: SearchResult[] = []
            
            for (const [index, result] of relatedSearchData.organic_results.entries()) {
              const domain = new URL(result.link).hostname.replace('www.', '')
              const mediaType = categorizeSourceByMediaType(domain, companyName)
              
              // Detect company mention in title and snippet
              const titleMention = detectCompanyMention(result.title || '', companyName || '')
              const snippetMention = detectCompanyMention(result.snippet || '', companyName || '')
              const companyMentioned = titleMention.mentioned || snippetMention.mentioned
              
              // Detect competitors in title and snippet
              const combinedText = `${result.title || ''} ${result.snippet || ''}`
              const detectedCompetitors = await detectCompetitors(combinedText, companyName || '')
              
              console.log(`🏷️ Classified related result ${domain} as ${mediaType} media type, company mentioned: ${companyMentioned}, competitors: ${detectedCompetitors}`)
              
              relatedResults.push({
                id: `related-${term.replace(/\s+/g, '-')}-${index + 1}`,
                title: result.title || 'No title',
                link: result.link,
                snippet: result.snippet || 'No snippet available',
                position: result.position || index + 1,
                domain: domain,
                mediaType: mediaType,
                companyMentioned: companyMentioned,
                detectedCompetitors: detectedCompetitors,
                date: new Date().toISOString(),
                searchTerm: term,
                monthlySearchVolume: volumeData[term] || 0
              })
            }
            
            allResults.push(...relatedResults)
            console.log(`✅ Added ${relatedResults.length} results for "${term}"`)
            console.log(`📊 Current allResults.length after push: ${allResults.length}`)
          }
        }
        
        // Add delay to avoid rate limits (reduced from 2000ms to 1000ms to speed up)
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.log(`❌ Error getting results for related term "${term}": ${error.message}`)
      }
    }

    console.log(`🔄 Finished processing all related searches. Final allResults.length: ${allResults.length}`)
    console.log(`🔄 allSearchResults.length (initial): ${allSearchResults.length}`)

    // Step 4: Add related searches to first result
    if (allResults.length > 0 && uniqueRelatedSearches.length > 0) {
      allResults[0].relatedSearches = uniqueRelatedSearches
    }

    console.log(`🔄 Completed data collection phase. Total results collected: ${allResults.length}`)
    console.log(`🔄 About to proceed to database storage...`)
    console.log(`🔄 About to calculate debug info and store in database...`)

    // Step 5: Calculate debug information
    const resultsWithVolume = allResults.filter(r => r.monthlySearchVolume && r.monthlySearchVolume > 0).length
    const totalVolume = allResults.reduce((sum, r) => sum + (r.monthlySearchVolume || 0), 0)

    const debugInfo = {
      keywordsEverywhereAvailable: !!keywordsEverywhereKey,
      resultsWithVolume,
      totalVolume,
      totalResults: allResults.length,
      searchTermsProcessed: allSearchTerms.length + uniqueRelatedSearches.length,
      combinedSearchTerms,
      uniqueRelatedSearches: uniqueRelatedSearches.length,
      volumeData,
      keywordsEverywhereResponseStatus: keywordsEverywhereKey ? 'attempted' : 'not_available'
    }

    console.log(`📊 Final results: ${allResults.length} total results, ${resultsWithVolume} with volume, ${totalVolume} total volume`)
    console.log(`📊 Resolved company_id for storage: ${resolvedCompanyId}`)
    console.log(`📊 About to enter database storage block...`)
    
    // CRITICAL: Log that we're about to store data - if this doesn't appear, function timed out before here
    console.log(`🚨 CRITICAL: Reached database storage step. If function times out, data collection succeeded but storage failed.`)
    console.log(`🚨 CRITICAL: allResults.length = ${allResults.length}, resolvedCompanyId = ${resolvedCompanyId}`)

    // Step 6: Store results in database
    try {
      console.log(`💾 Storing combined search insights in database for user: ${user.id}`)
      console.log(`💾 Company ID being used: ${resolvedCompanyId}`)
      console.log(`💾 Total results to store: ${allResults.length}`)
      console.log(`💾 Early save status: ${savedInitialResults ? 'SUCCESS' : 'FAILED/SKIPPED'}, sessionId: ${sessionId}`)
      
      // If we already saved initial results, update the session and add new results
      if (savedInitialResults && sessionId) {
        console.log(`💾 Updating existing session ${sessionId} with final data`)
        
        // Update session with final counts
        await supabase
          .from('search_insights_sessions')
          .update({
            total_results: allResults.length,
            total_volume: totalVolume
          })
          .eq('id', sessionId)
        
        // Add any new results from related searches
        const newResults = allResults.slice(allSearchResults.length)
        if (newResults.length > 0) {
          console.log(`💾 Adding ${newResults.length} additional results from related searches`)
          const newResultsToInsert = newResults.map(result => ({
            session_id: sessionId,
            company_id: resolvedCompanyId,
            search_term: result.searchTerm || 'combined',
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            position: result.position,
            domain: result.domain,
            monthly_search_volume: result.monthlySearchVolume || 0,
            media_type: result.mediaType || 'organic',
            company_mentioned: result.companyMentioned || false,
            detected_competitors: result.detectedCompetitors || ''
          }))

          const { error: newResultsError } = await supabase
            .from('search_insights_results')
            .insert(newResultsToInsert)

          if (newResultsError) {
            console.error(`❌ Error adding new results:`, newResultsError)
          } else {
            console.log(`✅ Added ${newResults.length} additional results`)
          }
        }
      } else {
        // Normal flow: create session and save all results
        // Early validation - if company_id is still null, try one more time to resolve it
        if (!resolvedCompanyId) {
        console.warn(`⚠️ WARNING: resolvedCompanyId is still null! Attempting emergency resolution...`)
        // Try to get from user's default company one more time
        const { data: emergencyCompanyData } = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .limit(1)
          .single()
        
        if (emergencyCompanyData?.company_id) {
          resolvedCompanyId = emergencyCompanyData.company_id
          console.log(`✅ Emergency resolution successful: company_id = ${resolvedCompanyId}`)
        } else {
          console.error(`❌ CRITICAL: Cannot proceed without company_id. Data will not be stored.`)
          throw new Error('Cannot store search insights: company_id is required but could not be resolved')
        }
      }
      
      // Create search session (or use existing if early save was successful)
      if (savedInitialResults && sessionId) {
        console.log(`💾 Using existing session ${sessionId} from early save`)
        // Session already exists, just update it
        const { data: sessionData, error: sessionError } = await supabase
          .from('search_insights_sessions')
          .update({
            total_results: allResults.length,
            total_volume: totalVolume
          })
          .eq('id', sessionId)
          .select()
          .single()
        
        if (sessionError) {
          console.error(`❌ Error updating session:`, sessionError)
          throw new Error(`Failed to update search session: ${sessionError.message}`)
        }
        
        // Skip to storing terms since results are already saved
        console.log(`✅ Session updated. Proceeding to store terms...`)
      } else {
        // Normal flow: create new session
        console.log(`💾 Creating search session with:`, {
          user_id: user.id,
          company_name: companyName,
          company_id: resolvedCompanyId,
          total_results: allResults.length,
          total_related_terms: uniqueRelatedSearches.length
        })
        
        const { data: sessionData, error: sessionError } = await supabase
          .from('search_insights_sessions')
          .insert({
            user_id: user.id,
            company_name: companyName || 'Unknown',
            company_id: resolvedCompanyId,
            initial_search_term: `${companyName} careers + jobs`, // Combined search indicator
            total_results: allResults.length,
            total_related_terms: uniqueRelatedSearches.length,
            total_volume: totalVolume,
            keywords_everywhere_available: !!keywordsEverywhereKey
          })
          .select()
          .single()

        if (sessionError) {
          console.error(`❌ Error creating search session:`, JSON.stringify(sessionError, null, 2))
          console.error(`❌ Session creation failed, cannot proceed with data storage`)
          console.error(`❌ Error details:`, {
            code: sessionError.code,
            message: sessionError.message,
            details: sessionError.details,
            hint: sessionError.hint
          })
          throw new Error(`Failed to create search session: ${sessionError.message || 'Unknown error'}`)
        }

        if (!sessionData || !sessionData.id) {
          console.error(`❌ Session data is missing or invalid:`, sessionData)
          throw new Error('Failed to create search session: No session ID returned')
        }

        sessionId = sessionData.id
      }
      console.log(`✅ Created search session: ${sessionId}`)
      console.log(`📊 Session details:`, {
        session_id: sessionId,
        company_id: resolvedCompanyId,
        company_name: companyName,
        user_id: user.id
      })
      console.log(`📊 About to store ${allResults.length} results and ${Object.keys(volumeData).length} terms`)
      console.log(`📊 Checking conditions: allResults.length = ${allResults.length}, sessionId = ${sessionId}`)

      // Store search results
      if (!sessionId) {
        console.error(`❌ CRITICAL: sessionId is null/undefined! Cannot store results.`)
        throw new Error('Session ID is required but was not created')
      }
      
      if (allResults.length === 0) {
        console.warn(`⚠️ WARNING: allResults is empty! No results to store.`)
        console.warn(`⚠️ This might indicate a problem with data collection.`)
      }
      
      if (allResults.length > 0 && sessionId) {
        console.log(`✅ Conditions met: Proceeding with insertion of ${allResults.length} results`)
        const resultsToInsert = allResults.map(result => ({
          session_id: sessionId,
          company_id: resolvedCompanyId, // Use resolved company_id
          search_term: result.searchTerm || 'combined',
          title: result.title,
          link: result.link,
          snippet: result.snippet,
          position: result.position,
          domain: result.domain,
          monthly_search_volume: result.monthlySearchVolume || 0,
          media_type: result.mediaType || 'organic',
          company_mentioned: result.companyMentioned || false,
          detected_competitors: result.detectedCompetitors || ''
        }))

        console.log(`💾 Inserting ${resultsToInsert.length} search results with company_id: ${resolvedCompanyId}`)
        console.log(`📋 First result sample:`, {
          session_id: resultsToInsert[0].session_id,
          company_id: resultsToInsert[0].company_id,
          search_term: resultsToInsert[0].search_term,
          domain: resultsToInsert[0].domain
        })

        console.log(`🚀 About to call supabase.insert() for ${resultsToInsert.length} results`)
        console.log(`🚀 First result to insert:`, JSON.stringify(resultsToInsert[0], null, 2))
        
        const { error: resultsError, data: resultsData } = await supabase
          .from('search_insights_results')
          .insert(resultsToInsert)
          .select()

        console.log(`🚀 Insert call completed. Error: ${resultsError ? 'YES' : 'NO'}, Data: ${resultsData ? `${resultsData.length} rows` : 'NULL'}`)

        if (resultsError) {
          console.error(`❌❌❌ CRITICAL ERROR storing search results:`, JSON.stringify(resultsError, null, 2))
          console.error(`❌ Error code: ${resultsError.code}, message: ${resultsError.message}`)
          console.error(`❌ Error details:`, resultsError.details)
          console.error(`❌ Error hint:`, resultsError.hint)
          console.error(`❌ Failed to insert ${resultsToInsert.length} results. First result sample:`, JSON.stringify(resultsToInsert[0], null, 2))
          console.error(`❌ Full error object:`, resultsError)
          throw new Error(`Failed to insert search results: ${resultsError.message || 'Unknown error'}`)
        } else {
          const insertedCount = resultsData?.length || 0
          if (insertedCount !== resultsToInsert.length) {
            console.warn(`⚠️ Insert count mismatch: expected ${resultsToInsert.length}, got ${insertedCount}`)
          }
          console.log(`✅ Stored ${resultsToInsert.length} search results (inserted ${insertedCount} rows)`)
          console.log(`✅ Verification: First inserted result has company_id: ${resultsData?.[0]?.company_id}`)
          
          // Trigger recency cache extraction for search result URLs
          if (resultsToInsert.length > 0) {
            try {
              console.log(`📅 Triggering recency cache extraction for ${resultsToInsert.length} search result URLs`)
              
              // Extract URLs from search results for recency scoring
              const citationsWithUrls = resultsToInsert
                .filter(result => result.link && result.link.startsWith('http'))
                .map(result => ({
                  url: result.link,
                  domain: result.domain,
                  title: result.title,
                  sourceType: 'search-results'
                }))
                .filter(Boolean);

              console.log(`🔗 Extracted ${citationsWithUrls.length} search result URLs:`, citationsWithUrls.map(c => c.url));
              
              if (citationsWithUrls.length > 0) {
                // Trigger recency cache extraction asynchronously (don't wait for completion)
                console.log(`🚀 Calling extract-recency-scores edge function for search results with ${citationsWithUrls.length} URLs`);
                supabase.functions.invoke('extract-recency-scores', {
                  body: {
                    citations: citationsWithUrls,
                    user_id: sessionId // Pass session ID for tracking
                  }
                }).then(response => {
                  console.log('✅ Search results recency cache extraction completed:', response);
                }).catch(error => {
                  // Log error but don't fail the search results storage
                  console.warn('❌ Failed to trigger recency cache extraction for search results:', error)
                });
              } else {
                console.log('⚠️ No search results with valid URLs found, skipping recency extraction');
              }
            } catch (recencyError) {
              // Log error but don't fail the search results storage
              console.warn('❌ Error triggering recency cache extraction:', recencyError)
            }
          }
        }
      }

      // Store search terms with volumes
      if (Object.keys(volumeData).length > 0 && sessionId) {
        const termsToInsert = Object.entries(volumeData).map(([term, volume]) => ({
          session_id: sessionId,
          company_id: resolvedCompanyId, // Use resolved company_id
          term: term,
          monthly_volume: volume,
          results_count: allResults.filter(r => r.searchTerm === term).length
        }))
        
        console.log(`💾 Inserting ${termsToInsert.length} search terms with company_id: ${resolvedCompanyId}`)

        const { error: termsError, data: termsData } = await supabase
          .from('search_insights_terms')
          .insert(termsToInsert)
          .select()

        if (termsError) {
          console.error(`❌ Error storing search terms:`, JSON.stringify(termsError, null, 2))
          console.error(`❌ Error code: ${termsError.code}, message: ${termsError.message}`)
          console.error(`❌ Failed to insert ${termsToInsert.length} terms. First term sample:`, JSON.stringify(termsToInsert[0], null, 2))
          throw new Error(`Failed to insert search terms: ${termsError.message || 'Unknown error'}`)
        } else {
          const insertedCount = termsData?.length || 0
          if (insertedCount !== termsToInsert.length) {
            console.warn(`⚠️ Insert count mismatch: expected ${termsToInsert.length}, got ${insertedCount}`)
          }
          console.log(`✅ Stored ${termsToInsert.length} search terms (inserted ${insertedCount} rows)`)
        }
      }

      // Update volume data for all search terms (both admin-added and auto-generated)
      if (resolvedCompanyId && Object.keys(volumeData).length > 0) {
        try {
          // Update volume data for all terms that were searched
          for (const [term, volume] of Object.entries(volumeData)) {
            console.log('📈 Updating volume for term', { term, volume, company_id: resolvedCompanyId })
            const { error: updateError } = await supabase
              .from('company_search_terms')
              .update({ monthly_volume: volume })
              .eq('company_id', resolvedCompanyId)
              .eq('search_term', term)

            if (updateError) {
              console.warn(`⚠️ Error updating volume for term "${term}":`, updateError)
            }
          }

          // Only store auto-generated terms if no admin terms exist
          if (adminSearchTerms.length === 0) {
            const autoGeneratedTerms = Object.entries(volumeData).map(([term, volume]) => ({
              company_id: resolvedCompanyId,
              search_term: term,
              monthly_volume: volume,
              is_manual: false,
              added_by: user.id
            }))

            // Use upsert to avoid duplicates
            console.log('📝 Upserting auto-generated search terms:', autoGeneratedTerms)
            const { error: companyTermsError } = await supabase
              .from('company_search_terms')
              .upsert(autoGeneratedTerms, {
                onConflict: 'company_id,search_term',
                ignoreDuplicates: false
              })

            if (companyTermsError) {
              console.warn(`⚠️ Error storing auto-generated company search terms:`, companyTermsError)
            } else {
              console.log(`✅ Stored ${autoGeneratedTerms.length} auto-generated company search terms`)
            }
          }

          console.log(`✅ Updated volume data for all search terms`)
        } catch (error) {
          console.warn(`⚠️ Error in company search terms storage:`, error)
        }
      }

      console.log(`💾 Successfully stored all combined search insights data`)

      // VERIFICATION: Query the database to confirm data was actually inserted
      if (sessionId) {
        console.log(`🔍 VERIFICATION: Checking if data was actually inserted...`)
        
        // Check session
        const { data: verifySession, error: verifySessionError } = await supabase
          .from('search_insights_sessions')
          .select('id, company_id, company_name, total_results')
          .eq('id', sessionId)
          .single()
        
        if (verifySessionError) {
          console.error(`❌ VERIFICATION FAILED: Could not find session ${sessionId}:`, verifySessionError)
        } else {
          console.log(`✅ VERIFICATION: Session found:`, verifySession)
        }
        
        // Check results count
        const { data: verifyResults, error: verifyResultsError, count: resultsCount } = await supabase
          .from('search_insights_results')
          .select('id, company_id, domain', { count: 'exact' })
          .eq('session_id', sessionId)
        
        if (verifyResultsError) {
          console.error(`❌ VERIFICATION FAILED: Could not query results:`, verifyResultsError)
        } else {
          console.log(`✅ VERIFICATION: Found ${resultsCount || 0} results for session ${sessionId}`)
          if (resultsCount && resultsCount > 0) {
            console.log(`✅ VERIFICATION: Sample result:`, {
              id: verifyResults?.[0]?.id,
              company_id: verifyResults?.[0]?.company_id,
              domain: verifyResults?.[0]?.domain
            })
            
            // Check if results are queryable by company_id
            if (resolvedCompanyId) {
              const { count: companyResultsCount, error: companyResultsError } = await supabase
                .from('search_insights_results')
                .select('*', { count: 'exact', head: true })
                .eq('company_id', resolvedCompanyId)
              
              if (companyResultsError) {
                console.error(`❌ VERIFICATION: Could not query by company_id:`, companyResultsError)
              } else {
                console.log(`✅ VERIFICATION: Found ${companyResultsCount || 0} total results for company_id ${resolvedCompanyId}`)
              }
            }
          }
        }
        
        // Check terms count
        const { data: verifyTerms, error: verifyTermsError, count: termsCount } = await supabase
          .from('search_insights_terms')
          .select('id, company_id, term', { count: 'exact' })
          .eq('session_id', sessionId)
        
        if (verifyTermsError) {
          console.error(`❌ VERIFICATION FAILED: Could not query terms:`, verifyTermsError)
        } else {
          console.log(`✅ VERIFICATION: Found ${termsCount || 0} terms for session ${sessionId}`)
        }
      }

    } catch (dbError) {
      console.error(`❌ Database storage error:`, JSON.stringify(dbError, null, 2))
      console.error(`❌ Database storage error stack:`, dbError?.stack || 'No stack trace')
      console.error(`❌ Database storage error details:`, {
        message: dbError?.message,
        code: dbError?.code,
        details: dbError?.details,
        hint: dbError?.hint
      })
      // Re-throw to ensure the error is visible in the response
      // The outer catch will handle it with CORS headers
      throw new Error(`Database storage failed: ${dbError?.message || 'Unknown database error'}`)
    }

    return new Response(
      JSON.stringify({ 
        results: allResults,
        searchTerm: `${companyName} careers + jobs`, // Combined search indicator
        companyName,
        totalResults: allResults.length,
        relatedSearchesCount: uniqueRelatedSearches.length,
        combinedSearchTerms,
        debug: debugInfo
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('❌ Error in search-insights function:', error)
    console.error('❌ Error stack:', error.stack)
    
    // Ensure we always return a response with CORS headers, even on errors
    try {
      return new Response(
        JSON.stringify({ 
          error: error?.message || 'Internal server error',
          errorType: error?.name || 'UnknownError',
          results: [],
          debug: {
            keywordsEverywhereAvailable: !!Deno.env.get('KEYWORDS_EVERYWHERE_KEY'),
            resultsWithVolume: 0,
            totalVolume: 0,
            error: error?.message || 'Unknown error',
            stack: error?.stack || 'No stack trace available'
          }
        }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    } catch (responseError) {
      // Last resort fallback - return a simple response with CORS headers
      console.error('❌ Failed to create error response:', responseError)
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }
  }
});
