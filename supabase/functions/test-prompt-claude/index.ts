import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

// Simple rate limiting - track requests per second
let requestCount = 0;
let lastResetTime = Date.now();

function checkRateLimit(): boolean {
  const now = Date.now();
  
  // Reset counter every second
  if (now - lastResetTime >= 1000) {
    requestCount = 0;
    lastResetTime = now;
  }
  
  // Check if we're under the limit (20 per second)
  if (requestCount >= 20) {
    return false; // Rate limit exceeded
  }
  
  requestCount++;
  return true; // OK to proceed
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      }
    })
  }

  try {
    // Check rate limit first
    if (!checkRateLimit()) {
      return new Response(
        JSON.stringify({ 
          error: 'Rate limit exceeded. Please wait a moment and try again.',
          retryAfter: 1000 // Wait 1 second
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': '1'
          } 
        }
      )
    }

    console.log('Request received:', req.method, req.url);
    
    const body = await req.json();
    console.log('Request body:', body);
    
    const { prompt, enableWebSearch = true } = body;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
    
    if (!claudeApiKey) {
      console.error('CLAUDE_API_KEY not found in environment variables');
      throw new Error('Claude API key not configured')
    }

    console.log('Making request to Claude API with web search...')

    const requestBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      tools: enableWebSearch ? [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5
      }] : []
    };

    console.log('Claude request body:', JSON.stringify(requestBody, null, 2));

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    })

    console.log('Claude API response status:', claudeResponse.status)
    
    const data = await claudeResponse.json()
    console.log('Claude API response data:', data)
    
    if (!claudeResponse.ok) {
      // Handle specific Claude API errors
      if (data.error?.type === 'authentication_error') {
        console.error('Claude API authentication error:', data.error);
        throw new Error('Claude API authentication failed - check API key')
      } else if (data.error?.type === 'rate_limit_error') {
        console.error('Claude API rate limit error:', data.error);
        // Return a user-friendly rate limit message
        return new Response(
          JSON.stringify({ 
            error: 'Claude API rate limit exceeded. Please wait a moment and try again.',
            details: data.error.message,
            retryAfter: 60000 // Wait 1 minute for Claude's rate limit
          }),
          { 
            status: 429, 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json',
              'Retry-After': '60'
            } 
          }
        )
      } else if (data.error?.type === 'invalid_request_error') {
        console.error('Claude API invalid request error:', data.error);
        throw new Error(`Claude API invalid request: ${data.error.message}`)
      } else {
        console.error('Claude API error:', data.error);
        throw new Error(data.error?.message || `Claude API error: ${claudeResponse.status}`)
      }
    }

    const response = data.content?.[0]?.text || 'No response generated'
    console.log('Claude response extracted:', response);

    // Extract Claude's native citations from the response
    const citations = extractClaudeCitations(data.content?.[0]);
    console.log('Extracted Claude citations:', citations);

    // Log web search usage if available
    if (data.usage?.server_tool_use?.web_search_requests) {
      console.log(`Web search requests made: ${data.usage.server_tool_use.web_search_requests}`);
    }

    return new Response(
      JSON.stringify({ 
        response,
        citations,
        webSearchEnabled: enableWebSearch,
        model: data.model,
        usage: data.usage
      }),
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

// Function to extract Claude's native citations
function extractClaudeCitations(content: any): any[] {
  const citations: any[] = [];
  
  if (!content || !content.content) {
    return citations;
  }

  // Look for web_search_result_location blocks in Claude's response
  content.content.forEach((block: any) => {
    if (block.type === 'web_search_result_location') {
      citations.push({
        url: block.url,
        title: block.title,
        cited_text: block.cited_text,
        encrypted_index: block.encrypted_index
      });
    }
  });

  return citations;
}