
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

    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY')
    
    if (!perplexityApiKey) {
      throw new Error('Perplexity API key not configured')
    }

    console.log('Making request to Perplexity API...')

    const perplexityResponse = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'Authorization': `Bearer ${perplexityApiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'Be precise and concise.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
    })

    console.log('Perplexity API response status:', perplexityResponse.status)
    console.log('Perplexity API response headers:', Object.fromEntries(perplexityResponse.headers.entries()))

    // Check if response is actually JSON
    const contentType = perplexityResponse.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const textResponse = await perplexityResponse.text()
      console.error('Non-JSON response from Perplexity:', textResponse)
      throw new Error(`Perplexity API returned non-JSON response: ${perplexityResponse.status}`)
    }

    const data = await perplexityResponse.json()
    console.log('Perplexity API response data:', data)
    
    if (!perplexityResponse.ok) {
      console.error('Perplexity API error:', data)
      throw new Error(data.error?.message || `Perplexity API error: ${perplexityResponse.status}`)
    }

    const response = data.choices?.[0]?.message?.content || 'No response generated'
    const citations = data.citations || []
    
    console.log('Extracted citations:', citations)

    return new Response(
      JSON.stringify({ 
        response,
        citations: citations.map((url: string) => ({
          url,
          domain: extractDomain(url),
          title: url,
          type: 'website',
          confidence: 'high'
        }))
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('Error in Perplexity function:', error)
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

function extractDomain(url: string): string {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname
  } catch {
    return 'unknown-domain'
  }
}
