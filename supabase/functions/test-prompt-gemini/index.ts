import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('Request received:', req.method, req.url);
    
    const body = await req.json();
    console.log('Request body:', body);
    
    const { prompt } = body;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
    
    if (!geminiApiKey) {
      console.error('GEMINI_API_KEY not found in environment variables');
      throw new Error('Gemini API key not configured')
    }

    console.log('Making request to Gemini API...')

    const requestBody = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500
      }
    };

    console.log('Gemini request body:', JSON.stringify(requestBody, null, 2));

    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey
      },
      body: JSON.stringify(requestBody)
    })

    console.log('Gemini API response status:', geminiResponse.status)
    
    const data = await geminiResponse.json()
    console.log('Gemini API response data:', data)
    
    if (!geminiResponse.ok) {
      // Handle specific Gemini API errors
      if (data.error?.message?.includes('overloaded') || data.error?.message?.includes('quota')) {
        throw new Error('The model is currently overloaded. Please try again later.')
      }
      
      if (data.error?.message?.includes('quota')) {
        throw new Error('API quota exceeded. Please try again later.')
      }
      
      if (data.error?.message?.includes('invalid')) {
        throw new Error('Invalid request. Please check your prompt and try again.')
      }
      
      throw new Error(data.error?.message || `Gemini API error: ${geminiResponse.status}`)
    }

    const response = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated'
    console.log('Generated response:', response);

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
    console.error('Error in edge function:', error)
    console.error('Error stack:', error.stack)
    
    // Return appropriate HTTP status codes based on error type
    let statusCode = 500
    if (error.message.includes('overloaded') || error.message.includes('quota')) {
      statusCode = 429 // Too Many Requests
    } else if (error.message.includes('invalid')) {
      statusCode = 400 // Bad Request
    } else if (error.message.includes('API key')) {
      statusCode = 401 // Unauthorized
    } else if (error.message.includes('required')) {
      statusCode = 400 // Bad Request
    }
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.message.includes('overloaded') ? 'The AI model is currently experiencing high demand. Please try again in a few minutes.' : undefined,
        stack: error.stack
      }),
      { 
        status: statusCode, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
}) 