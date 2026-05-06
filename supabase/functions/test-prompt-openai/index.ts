import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { SOURCES_SECTION_REGEX } from "../_shared/citation-extraction.ts"

// Enhanced citation extraction from response text
function extractCitationsFromResponse(text: string): any[] {
  const citations: any[] = []
  const seenUrls = new Set<string>()
  
  // Extract URLs (most reliable)
  const urlPattern = /https?:\/\/([^\s\)]+)/g
  let match
  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, '') // Remove trailing punctuation
    if (!seenUrls.has(url)) {
      try {
        const domain = new URL(url).hostname.replace('www.', '')
        citations.push({
          url,
          domain,
          title: `Source from ${domain}`
        })
        seenUrls.add(url)
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }
  
  // Extract numbered citations [1], [2] with potential URLs nearby
  const citationPattern = /\[(\d+)\][\s]*([^\[]*?)(?:https?:\/\/[^\s\)]+)?/g
  while ((match = citationPattern.exec(text)) !== null) {
    const num = match[1]
    const context = match[2]?.trim()
    // Try to find URL in nearby text (200 chars after citation)
    const nearbyText = text.substring(Math.max(0, match.index - 50), match.index + 200)
    const urlMatch = nearbyText.match(/https?:\/\/([^\s\)]+)/)
    const citationKey = `citation-${num}`
    if (!seenUrls.has(citationKey)) {
      citations.push({
        domain: context || 'unknown',
        title: `Citation [${num}]${context ? `: ${context}` : ''}`,
        url: urlMatch ? urlMatch[0] : undefined
      })
      seenUrls.add(citationKey)
    }
  }
  
  // Extract "Sources" section (all app languages: Fontes, Fuentes, Quellen, 出典, etc.)
  const sourcesMatch = text.match(SOURCES_SECTION_REGEX)
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1]
    const sourceUrls = sourcesText.match(/https?:\/\/([^\s\n\)]+)/g) || []
    sourceUrls.forEach(url => {
      if (!seenUrls.has(url)) {
        try {
          const domain = new URL(url).hostname.replace('www.', '')
          citations.push({ url, domain, title: `Source from ${domain}` })
          seenUrls.add(url)
        } catch (e) {}
      }
    })
  }

  // Only return citations with a valid url so DB and MVs (citation_url, recency) stay consistent
  return citations.filter((c): c is typeof c & { url: string } => !!c?.url && typeof c.url === 'string')
}

// Exponential backoff retry for rate limit errors
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error?.status === 429 || 
                         error?.response?.status === 429 ||
                         error?.message?.includes('rate limit') ||
                         error?.message?.includes('429')
      
      if (isRateLimit && attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000
        console.log(`Rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      
      throw error
    }
  }
  
  throw lastError
}

// Call GPT-5.2 Chat Completions (no web search)
async function callGPT52(prompt: string): Promise<{ response: string; citations: any[] }> {
  // Try GPT-5.2 variants in order (no fallback to older models)
  // Start with chat-latest which is confirmed to work
  const models = [
    { name: 'gpt-5.2-chat-latest', description: 'GPT-5.2 Instant (fastest)' }
    // Note: Other variants (gpt-5.2, gpt-5.2-pro) may require different endpoints or parameters
  ]
  
  for (const modelConfig of models) {
    try {
      console.log(`Trying model: ${modelConfig.name} (${modelConfig.description})`)
      
      const result = await retryWithBackoff(async () => {
        const body: any = {
          model: modelConfig.name,
          messages: [
            {
              role: 'system',
              content: `You are a research assistant providing well-sourced information about companies.
When you reference information, include the specific sources you would naturally cite. Format:
- Include full URLs (https://...) for any sources you reference
- Use citation markers [1], [2], [3] for sources mentioned in your response
- Mention source names naturally when relevant (e.g., "As reported by...", "According to...")
- End with a "Sources:" section listing all URLs you referenced`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_completion_tokens: 2000 // GPT-5.2 uses tokens for reasoning + content, need higher limit
          // Note: GPT-5.2 may use reasoning tokens, so we need enough tokens for both reasoning and actual content
        }
        
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        
        const data = await openaiResponse.json()
        
        if (!openaiResponse.ok) {
          const errorDetails = {
            status: openaiResponse.status,
            statusText: openaiResponse.statusText,
            error: data.error,
            model: modelConfig.name,
            headers: Object.fromEntries(openaiResponse.headers.entries())
          }
          console.error(`OpenAI API error for ${modelConfig.name}:`, JSON.stringify(errorDetails, null, 2))
          
          // Create error with full details
          const error: any = new Error(data.error?.message || `OpenAI API error: ${openaiResponse.status}`)
          error.status = openaiResponse.status
          error.response = { status: openaiResponse.status, data }
          throw error
        }
        
        // Handle GPT-5.2 response format - check multiple possible locations
        const content = data.choices?.[0]?.message?.content || 
                       data.choices?.[0]?.message?.text ||
                       data.content ||
                       data.text
        
        // Debug: Log the response structure
        console.log(`Response from ${modelConfig.name}:`, JSON.stringify({
          hasChoices: !!data.choices,
          choicesLength: data.choices?.length,
          firstChoice: data.choices?.[0] ? {
            hasMessage: !!data.choices[0].message,
            messageKeys: data.choices[0].message ? Object.keys(data.choices[0].message) : [],
            content: data.choices[0].message?.content,
            contentLength: data.choices[0].message?.content?.length
          } : null
        }, null, 2))
        
        if (content) {
          const response = typeof content === 'string' ? content : JSON.stringify(content)
          const citations = extractCitationsFromResponse(response)
          console.log(`✅ Successfully used model: ${modelConfig.name}, response length: ${response.length}, citations: ${citations.length}`)
          return { response, citations }
        } else {
          // Log full response for debugging - include actual response in error
          const debugInfo = {
            hasChoices: !!data.choices,
            choicesLength: data.choices?.length,
            firstChoiceKeys: data.choices?.[0] ? Object.keys(data.choices[0]) : [],
            messageKeys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [],
            messageContent: data.choices?.[0]?.message?.content,
            messageContentType: typeof data.choices?.[0]?.message?.content,
            fullResponse: JSON.stringify(data).substring(0, 1000) // First 1000 chars
          }
          console.error(`No content in response from ${modelConfig.name}:`, JSON.stringify(debugInfo, null, 2))
          const error: any = new Error(`No content in response from ${modelConfig.name}`)
          error.debugInfo = debugInfo
          error.responseData = data
          throw error
        }
      })
      
      return result
    } catch (modelError: any) {
      console.error(`❌ Model ${modelConfig.name} failed:`, {
        message: modelError.message,
        status: modelError.status,
        error: modelError.response?.data?.error
      })
      
      // If it's not a rate limit error and not the last model, try next variant
      if (modelError.status !== 429 && modelConfig !== models[models.length - 1]) {
        console.log(`Trying next GPT-5.2 variant...`)
        continue
      }
      
      // If it's the last model or a non-retryable error, throw with debug info
      if (modelConfig === models[models.length - 1]) {
        let errorMessage = `All GPT-5.2 variants failed. Last error: ${modelError.message}`
        if (modelError.debugInfo) {
          const debugStr = JSON.stringify(modelError.debugInfo, null, 2)
          console.error('Debug info from failed model:', debugStr)
          errorMessage += `. Debug: ${debugStr.substring(0, 500)}`
        }
        if (modelError.responseData) {
          const responseStr = JSON.stringify(modelError.responseData).substring(0, 1000)
          errorMessage += `. Response: ${responseStr}`
        }
        throw new Error(errorMessage)
      }
    }
  }
  
  throw new Error('All GPT-5.2 models failed')
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
    const { prompt } = await req.json()

    if (!prompt) {
      throw new Error('Prompt is required')
    }

    // Use GPT-5.2 Chat Completions API with enhanced prompting for citations
    const result = await callGPT52(prompt)
    
    return new Response(
      JSON.stringify(result),
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