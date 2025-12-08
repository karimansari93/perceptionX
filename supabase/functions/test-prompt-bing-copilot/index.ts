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
      // Return graceful fallback to avoid breaking onboarding
      return new Response(
        JSON.stringify({ 
          response: 'Bing Copilot is not configured. Please set SERP_API_KEY to enable this feature.',
          citations: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call Bing Copilot API directly
    const bingCopilotUrl = `https://serpapi.com/search?engine=bing_copilot&q=${encodeURIComponent(prompt)}&api_key=${serpApiKey}`
    
    console.log('Bing Copilot API URL:', bingCopilotUrl)

    let copilotData: any;
    try {
      const copilotResponse = await fetch(bingCopilotUrl)
      console.log('Bing Copilot response status:', copilotResponse.status)
      
      copilotData = await copilotResponse.json()
      console.log('Bing Copilot response data keys:', Object.keys(copilotData))

      if (!copilotResponse.ok) {
        console.error('SERP API error:', copilotData)
        // Graceful fallback instead of throwing 500
        return new Response(
          JSON.stringify({ 
            response: `Bing Copilot API error: ${copilotData.error || 'unexpected error'}`,
            citations: []
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError)
      // Graceful fallback instead of throwing 500
      return new Response(
        JSON.stringify({ 
          response: `Failed to fetch Bing Copilot results: ${fetchError.message}`,
          citations: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract the response and citations from Bing Copilot data
    let response = 'No response generated'
    let citations: any[] = []
    
    // Process text_blocks to build the response
    if (copilotData.text_blocks && Array.isArray(copilotData.text_blocks)) {
      const responseParts: string[] = []
      
      // Add header if present
      if (copilotData.header) {
        responseParts.push(copilotData.header)
      }
      
      // Process each text block
      for (const block of copilotData.text_blocks) {
        if (block.type === 'paragraph') {
          responseParts.push(block.snippet || '')
        } else if (block.type === 'heading') {
          // Add heading with appropriate level
          const level = block.level || 2
          const prefix = '#'.repeat(level) + ' '
          responseParts.push(`\n${prefix}${block.snippet}\n`)
        } else if (block.type === 'list' && block.list) {
          // Process list items (including nested lists)
          const processList = (items: any[], indent: number = 0): string[] => {
            const listParts: string[] = []
            const indentStr = '  '.repeat(indent)
            for (const item of items) {
              if (item.snippet) {
                listParts.push(`${indentStr}• ${item.snippet}`)
              }
              // Handle nested lists
              if (item.list && Array.isArray(item.list)) {
                listParts.push(...processList(item.list, indent + 1))
              }
            }
            return listParts
          }
          responseParts.push(...processList(block.list))
        } else if (block.type === 'code_block' && block.code) {
          // Add code block with language if specified
          const lang = block.language || ''
          responseParts.push(`\n\`\`\`${lang}\n${block.code}\n\`\`\`\n`)
        } else if (block.type === 'table' && block.table) {
          // Format table as markdown
          if (block.headers && block.headers.length > 0) {
            const headerRow = '| ' + block.headers.join(' | ') + ' |'
            const separatorRow = '| ' + block.headers.map(() => '---').join(' | ') + ' |'
            responseParts.push(`\n${headerRow}\n${separatorRow}`)
            
            for (const row of block.table) {
              if (Array.isArray(row)) {
                responseParts.push('| ' + row.join(' | ') + ' |')
              }
            }
            responseParts.push('')
          }
        }
      }
      
      response = responseParts
        .filter((text: string) => text.trim())
        .join('\n\n')
    } else if (copilotData.header) {
      // Fallback to just the header if no text_blocks
      response = copilotData.header
    }
    
    // Extract citations from references
    if (copilotData.references && Array.isArray(copilotData.references)) {
      citations = copilotData.references.map((ref: any) => ({
        title: ref.title || '',
        url: ref.link || '',
        snippet: ref.snippet || '',
        source: ref.source || ''
      }))
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
    // Last-resort graceful fallback
    return new Response(
      JSON.stringify({ 
        response: `Bing Copilot temporary error: ${error.message}`,
        citations: []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})




