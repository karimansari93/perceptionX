import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildSerpAPIUrl, getKeywordsEverywhereCountry } from "../_shared/location-utils.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SearchResult {
  id?: string;
  title: string;
  link: string;
  snippet: string;
  position: number;
  domain: string;
  monthlySearchVolume: number;
  mediaType: string;
  companyMentioned: boolean;
  detectedCompetitors: string;
  date: string;
  searchTerm: string;
  mentionCount?: number;
  searchTermsCount?: number;
  allSearchTerms?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestBody = await req.json()
    const { company_id, search_terms } = requestBody
    
    if (!company_id || !search_terms || !Array.isArray(search_terms)) {
      return new Response(
        JSON.stringify({ error: 'Company ID and search terms array are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    const serpApiKey = Deno.env.get('SERP_API_KEY')
    const keywordsEverywhereKey = Deno.env.get('KEYWORDS_EVERYWHERE_KEY')
    
    if (!serpApiKey) {
      return new Response(
        JSON.stringify({ error: 'SerpAPI key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🔍 Searching new admin terms for company: ${company_id}`)
    console.log(`🎯 Search terms:`, search_terms)

    // Fetch country from user_onboarding for this company
    let countryCode: string | null = null
    try {
      const { data: onboardingData, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('country')
        .eq('company_id', company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!onboardingError && onboardingData?.country) {
        countryCode = onboardingData.country
        console.log(`🌍 Found country for company: ${countryCode}`)
      } else {
        // Fallback: try to get country from user_onboarding by user_id
        console.log(`⚠️ No country found via company_id, trying user_id fallback`)
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

    // Get volume data for the search terms
    const volumeData: { [key: string]: number } = {}
    if (keywordsEverywhereKey) {
      try {
        const keCountry = getKeywordsEverywhereCountry(countryCode)
        console.log(`🌍 Using Keywords Everywhere country: ${keCountry}`)
        
        const volumeUrl = `https://api.keywordseverywhere.com/v1/get_keyword_data`
        const formData = new FormData()
        formData.append('country', keCountry)
        formData.append('currency', 'usd')
        formData.append('dataSource', 'gkp')
        
        // Add each search term to the form data
        search_terms.forEach(term => {
          formData.append('kw[]', term)
        })
        
        const volumeResponse = await fetch(volumeUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${keywordsEverywhereKey}`
          },
          body: formData
        })

        if (volumeResponse.ok) {
          const volumeDataResponse = await volumeResponse.json()
          console.log(`📈 Volume API response:`, JSON.stringify(volumeDataResponse, null, 2))
          
          if (volumeDataResponse.data && Array.isArray(volumeDataResponse.data)) {
            volumeDataResponse.data.forEach((item: any) => {
              const keyword = item.keyword || item.kw
              const volume = item.vol || item.volume || item.search_volume || 0
              if (keyword) {
                volumeData[keyword] = volume
              }
            })
          }
        } else {
          const errorText = await volumeResponse.text()
          console.log(`❌ Volume API error: ${volumeResponse.status} - ${errorText}`)
        }
      } catch (error) {
        console.warn('⚠️ Error fetching volume data:', error)
      }
    }

    // Perform searches for each term
    const allSearchResults: SearchResult[] = []
    const allRelatedSearches: string[] = []

    for (const [index, searchTerm] of search_terms.entries()) {
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
        console.log(`📡 Calling SERP API with location params: ${searchUrl}`)
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
        const searchResults = searchData.organic_results.map((result: any, position: number) => ({
          title: result.title || 'No title',
          link: result.link || '',
          snippet: result.snippet || '',
          position: position + 1,
          domain: new URL(result.link || '').hostname || 'unknown',
          monthlySearchVolume: volumeData[searchTerm] || 0,
          mediaType: 'organic',
          companyMentioned: false,
          detectedCompetitors: '',
          date: new Date().toISOString(),
          searchTerm: searchTerm
        }))

        allSearchResults.push(...searchResults)

        // Collect related searches
        if (searchData.related_searches) {
          const relatedSearches = searchData.related_searches.map((related: any) => related.query).filter(Boolean)
          allRelatedSearches.push(...relatedSearches)
        }

        // Add delay between searches to avoid rate limiting
        if (index < search_terms.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }

      } catch (error) {
        console.error(`❌ Error searching for "${searchTerm}":`, error)
        // Continue with other terms even if one fails
      }
    }

    // Update volume data for the admin terms in the database
    for (const [term, volume] of Object.entries(volumeData)) {
      const { error: updateError } = await supabase
        .from('company_search_terms')
        .update({ monthly_volume: volume })
        .eq('company_id', company_id)
        .eq('search_term', term)
        .eq('is_manual', true)

      if (updateError) {
        console.warn(`⚠️ Error updating volume for term "${term}":`, updateError)
      }
    }

    // Store results in database
    try {
      console.log(`💾 Storing search insights in database for user: ${user.id}`)
      
      // Get company name
      const { data: companyData } = await supabase
        .from('companies')
        .select('name')
        .eq('id', company_id)
        .single()
      
      const companyName = companyData?.name || 'Unknown'

      // Calculate total volume
      const totalVolume = Object.values(volumeData).reduce((sum, vol) => sum + vol, 0)

      // Create search session
      const { data: sessionData, error: sessionError } = await supabase
        .from('search_insights_sessions')
        .insert({
          user_id: user.id,
          company_name: companyName,
          company_id: company_id,
          initial_search_term: search_terms.join(', '), // Admin terms
          total_results: allSearchResults.length,
          total_related_terms: allRelatedSearches.length,
          total_volume: totalVolume,
          keywords_everywhere_available: !!Deno.env.get('KEYWORDS_EVERYWHERE_KEY')
        })
        .select()
        .single()

      if (sessionError) {
        console.error(`❌ Error creating search session:`, sessionError)
        throw sessionError
      }

      const sessionId = sessionData.id
      console.log(`✅ Created search session: ${sessionId}`)

      // Store search results
      if (allSearchResults.length > 0) {
        const resultsToInsert = allSearchResults.map(result => ({
          session_id: sessionId,
          company_id: company_id,
          search_term: result.searchTerm || 'unknown',
          title: result.title,
          link: result.link,
          snippet: result.snippet,
          position: result.position,
          domain: result.domain,
          monthly_search_volume: result.monthlySearchVolume || 0,
          media_type: result.mediaType || 'organic'
        }))

        const { error: resultsError } = await supabase
          .from('search_insights_results')
          .insert(resultsToInsert)

        if (resultsError) {
          console.error(`❌ Error storing search results:`, resultsError)
        } else {
          console.log(`✅ Stored ${resultsToInsert.length} search results`)
        }
      }

      // Store search terms with volumes
      if (Object.keys(volumeData).length > 0) {
        const termsToInsert = Object.entries(volumeData).map(([term, volume]) => ({
          session_id: sessionId,
          company_id: company_id,
          term: term,
          monthly_volume: volume,
          results_count: allSearchResults.filter(r => r.searchTerm === term).length
        }))

        const { error: termsError } = await supabase
          .from('search_insights_terms')
          .insert(termsToInsert)

        if (termsError) {
          console.error(`❌ Error storing search terms:`, termsError)
        } else {
          console.log(`✅ Stored ${termsToInsert.length} search terms with volumes`)
        }
      }

      console.log(`✅ Completed search for ${search_terms.length} admin terms`)
      console.log(`📊 Total results: ${allSearchResults.length}`)
      console.log(`🔗 Related searches: ${allRelatedSearches.length}`)

      return new Response(
        JSON.stringify({ 
          sessionId: sessionId,
          results: allSearchResults,
          searchTerms: search_terms,
          totalResults: allSearchResults.length,
          relatedSearchesCount: allRelatedSearches.length,
          volumeData
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    } catch (storageError) {
      console.error('❌ Error storing results:', storageError)
      // Still return results even if storage fails
      return new Response(
        JSON.stringify({ 
          results: allSearchResults,
          searchTerms: search_terms,
          totalResults: allSearchResults.length,
          relatedSearchesCount: allRelatedSearches.length,
          volumeData,
          storageError: 'Failed to store results in database'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

  } catch (error) {
    console.error('❌ Error in search-new-admin-terms function:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
