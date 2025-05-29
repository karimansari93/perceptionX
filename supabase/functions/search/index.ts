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
    const { query, engine = 'google', numResults = 10 } = await req.json()
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Missing query parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const serpApiKey = Deno.env.get('SERPAPI_API_KEY')
    if (!serpApiKey) {
      console.error('SerpAPI key not configured')
      return new Response(
        JSON.stringify({ error: 'SerpAPI key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Searching ${engine} for query: ${query}`)
    
    const searchUrl = `https://serpapi.com/search?engine=${engine}&q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=${numResults}`
    console.log('Search URL:', searchUrl)

    const searchResponse = await fetch(searchUrl)
    const data = await searchResponse.json()

    if (!searchResponse.ok) {
      console.error('SerpAPI error:', data)
      throw new Error(data.error || 'Search API error')
    }

    if (!data.organic_results) {
      console.error('Invalid response format:', data)
      throw new Error('Invalid response format from search API')
    }

    return new Response(
      JSON.stringify(data),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('Error in search function:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.toString()
      }),
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