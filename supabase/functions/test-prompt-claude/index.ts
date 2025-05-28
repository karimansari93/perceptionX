
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

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
    
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured')
    }

    console.log('Making request to Claude API...')
    
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${claudeApiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-12-15'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
    })

    console.log('Claude API response status:', claudeResponse.status)
    
    const data = await claudeResponse.json()
    console.log('Claude API response data:', data)
    
    if (!claudeResponse.ok) {
      console.error('Claude API error:', data)
      throw new Error(data.error?.message || `Claude API error: ${claudeResponse.status}`)
    }

    const response = data.content?.[0]?.text || 'No response generated'

    return new Response(
      JSON.stringify({ response }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('Error in Claude function:', error)
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
