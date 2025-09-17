import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt } = await req.json()

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Call OpenAI GPT-4 with higher token limits for comprehensive reports
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert AI perception analyst and business consultant specializing in employer branding and talent acquisition. You have access to a comprehensive database containing:

- Detailed AI response analysis across multiple models (GPT-4, Claude, Gemini, Perplexity)
- Comprehensive theme analysis mapped to 30 TalentX employer branding attributes
- Sentiment analysis with confidence scores for each theme
- Competitive intelligence with detailed mention tracking
- Source analysis showing citation patterns and missed opportunities
- Geographic distribution of sources and regional insights
- Historical trend data and performance metrics

Create comprehensive, detailed, and actionable reports that help companies understand and improve their AI visibility. Your analysis should:

1. Provide deep insights into what specific themes drive positive sentiment
2. Identify exactly which sources are missing company mentions and why
3. Analyze competitive positioning with specific data points
4. Offer concrete, measurable recommendations with clear timelines
5. Explain how to achieve 100% visibility from current levels
6. Reference specific competitors, sources, and themes from the data

Use specific data points, provide concrete recommendations, and deliver substantial value. Write in a professional, executive-level tone that demonstrates deep strategic thinking and leverages the full analytical power of the database.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 3000, // Increased token limit for more comprehensive reports
        temperature: 0.3, // Lower temperature for more consistent, professional output
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      }),
    })

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json()
      console.error('OpenAI API error:', errorData)
      throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`)
    }

    const openaiData = await openaiResponse.json()
    const response = openaiData.choices[0]?.message?.content || 'Analysis not available.'

    return new Response(
      JSON.stringify({ response }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in generate-ai-report function:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to generate AI report',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
