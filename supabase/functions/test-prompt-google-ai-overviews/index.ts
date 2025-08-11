import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt } = await req.json()
    console.log('Received prompt:', prompt)

    if (!prompt) {
      console.error('Missing prompt parameter')
      return new Response(
        JSON.stringify({ error: 'Missing prompt parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const serpApiKey = Deno.env.get('SERP_API_KEY')
    console.log('SERP API key available:', !!serpApiKey)
    
    if (!serpApiKey) {
      console.error('SERP API key not configured')
      return new Response(
        JSON.stringify({ error: 'SERP API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 1: Make a regular Google search to get the ai_overview.page_token
    const searchUrl = `https://serpapi.com/search?engine=google&q=${encodeURIComponent(prompt)}&api_key=${serpApiKey}`
    
    console.log('Step 1 - Google search URL:', searchUrl)

    let searchData: any;
    try {
      const searchResponse = await fetch(searchUrl)
      console.log('Search response status:', searchResponse.status)
      
      searchData = await searchResponse.json()
      console.log('Search response data keys:', Object.keys(searchData))

      if (!searchResponse.ok) {
        console.error('SERP API error:', searchData)
        throw new Error(searchData.error || 'Google search API error')
      }
    } catch (fetchError) {
      console.error('Fetch error in step 1:', fetchError)
      throw new Error(`Failed to fetch search results: ${fetchError.message}`)
    }

    // Check if AI overview is available
    if (!searchData.ai_overview || !searchData.ai_overview.page_token) {
      console.log('No AI overview available for this query')
      return new Response(
        JSON.stringify({ 
          response: 'No AI overview available for this query. This could be because the query is too specific or AI overviews are not available for this topic.',
          citations: []
        }),
        { 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    // Step 2: Use the page_token to fetch the AI overview
    const aiOverviewUrl = `https://serpapi.com/search?engine=google_ai_overview&page_token=${searchData.ai_overview.page_token}&api_key=${serpApiKey}`
    
    console.log('Step 2 - AI Overview URL:', aiOverviewUrl)

    const aiOverviewResponse = await fetch(aiOverviewUrl)
    const aiOverviewData = await aiOverviewResponse.json()

    if (!aiOverviewResponse.ok) {
      console.error('AI Overview API error:', aiOverviewData)
      throw new Error(aiOverviewData.error || 'Google AI Overview API error')
    }

    // Extract the AI overview response and citations
    let response = 'No response generated'
    let citations: any[] = []
    
    if (aiOverviewData.ai_overview && aiOverviewData.ai_overview.text_blocks) {
      // Combine all text blocks into a single response
      response = aiOverviewData.ai_overview.text_blocks
        .map((block: any) => {
          if (block.type === 'paragraph') {
            return block.snippet
          } else if (block.type === 'list' && block.list) {
            return block.list.map((item: any) => `• ${item.title}: ${item.snippet}`).join('\n')
          } else if (block.type === 'heading') {
            return `\n${block.snippet}\n`
          }
          return block.snippet || ''
        })
        .filter((text: string) => text.trim())
        .join('\n\n')
      
      // Extract citations from references
      if (aiOverviewData.ai_overview.references) {
        citations = aiOverviewData.ai_overview.references.map((ref: any) => ({
          title: ref.title,
          url: ref.link,
          snippet: ref.snippet,
          source: ref.source
        }))
      }
    } else if (aiOverviewData.ai_overview && aiOverviewData.ai_overview.error) {
      response = `AI Overview error: ${aiOverviewData.ai_overview.error}`
    }

    return new Response(
      JSON.stringify({ response, citations }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
}) 