import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { fetchGoogleAiOverview } from "../_shared/google-serp.ts"

// Thin HTTP wrapper: provider selection (SerpAPI vs Scrapingdog) and all
// parsing live in _shared/google-serp.ts behind GOOGLE_SERP_PROVIDER.
// Contract is unchanged: POST { prompt } -> { response, citations } with a
// graceful (non-500) fallback body on any provider error, so collection runs
// never abort on a missing AI overview.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt, location_context } = await req.json()
    console.log('Received prompt:', prompt)

    if (!prompt) {
      console.error('Missing prompt parameter')
      return new Response(
        JSON.stringify({ error: 'Missing prompt parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = await fetchGoogleAiOverview(prompt, location_context)
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    // Last-resort graceful fallback
    return new Response(
      JSON.stringify({
        response: `Google AI Overviews temporary error: ${error.message}`,
        citations: []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
