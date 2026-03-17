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
        JSON.stringify({
          response: 'Google AI Mode is not configured. Please set SERP_API_KEY to enable this feature.',
          citations: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Google AI Mode is a single-step API call (unlike AI Overviews which needs page_token)
    const searchUrl = `https://serpapi.com/search?engine=google_ai_mode&q=${encodeURIComponent(prompt)}&api_key=${serpApiKey}`

    console.log('Google AI Mode search URL (key redacted):', searchUrl.replace(serpApiKey, '***'))

    let searchData: any;
    try {
      const searchResponse = await fetch(searchUrl)
      console.log('Search response status:', searchResponse.status)

      searchData = await searchResponse.json()
      console.log('Search response data keys:', Object.keys(searchData))

      if (!searchResponse.ok) {
        console.error('SERP API error:', searchData)
        return new Response(
          JSON.stringify({
            response: `Google AI Mode API error: ${searchData.error || 'unexpected error'}`,
            citations: []
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError)
      return new Response(
        JSON.stringify({
          response: `Failed to fetch Google AI Mode results: ${fetchError.message}`,
          citations: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract response from text_blocks (at root level, not nested under ai_overview)
    let response = 'No response generated'
    let citations: any[] = []

    if (searchData.text_blocks && Array.isArray(searchData.text_blocks)) {
      // Combine all text blocks into a single response
      response = searchData.text_blocks
        .map((block: any) => {
          if (block.type === 'paragraph') {
            return block.snippet
          } else if (block.type === 'list' && block.list) {
            return block.list.map((item: any) => {
              // List items can have nested text_blocks
              if (item.text_blocks && Array.isArray(item.text_blocks)) {
                return item.text_blocks
                  .map((tb: any) => tb.snippet || '')
                  .filter((s: string) => s.trim())
                  .join(' ')
              }
              return `• ${item.title || ''}${item.snippet ? ': ' + item.snippet : ''}`
            }).join('\n')
          } else if (block.type === 'heading') {
            return `\n${block.snippet}\n`
          } else if (block.type === 'table' && block.table) {
            // Format table as text
            const headers = block.table.headers?.join(' | ') || ''
            const rows = (block.table.rows || []).map((row: any) => row.join(' | ')).join('\n')
            return headers ? `${headers}\n${rows}` : rows
          } else if (block.type === 'code_block') {
            return block.snippet || ''
          }
          return block.snippet || ''
        })
        .filter((text: string) => text.trim())
        .join('\n\n')

      // Extract citations from references — check multiple possible locations
      const seenUrls = new Set<string>()
      const addRef = (ref: any) => {
        const url = ref.link || ref.url || ref.href
        if (!url || seenUrls.has(url)) return
        seenUrls.add(url)
        citations.push({
          title: ref.title || ref.name,
          url,
          snippet: ref.snippet || ref.description,
          source: ref.source || ref.displayed_link
        })
      }

      // 1. Root-level "references" array
      if (searchData.references && Array.isArray(searchData.references)) {
        searchData.references.forEach(addRef)
      }
      // 2. Root-level "sources" array (alternative naming)
      if (searchData.sources && Array.isArray(searchData.sources)) {
        searchData.sources.forEach(addRef)
      }
      // 3. References nested inside individual text_blocks
      for (const block of searchData.text_blocks) {
        if (block.references && Array.isArray(block.references)) {
          block.references.forEach(addRef)
        }
        if (block.sources && Array.isArray(block.sources)) {
          block.sources.forEach(addRef)
        }
        // Also check list items for references
        if (block.list && Array.isArray(block.list)) {
          for (const item of block.list) {
            if (item.references && Array.isArray(item.references)) {
              item.references.forEach(addRef)
            }
            if (item.sources && Array.isArray(item.sources)) {
              item.sources.forEach(addRef)
            }
          }
        }
      }

      console.log(`Extracted ${citations.length} citations from ${seenUrls.size} unique URLs`)
      // Log structure for debugging if no citations found
      if (citations.length === 0) {
        const sampleBlock = searchData.text_blocks[0]
        console.log('Sample text_block keys:', sampleBlock ? Object.keys(sampleBlock) : 'none')
        console.log('Root-level keys:', Object.keys(searchData))
        // Log any key that looks like it could contain references
        for (const key of Object.keys(searchData)) {
          if (key !== 'text_blocks' && key !== 'search_metadata' && key !== 'search_parameters') {
            console.log(`searchData.${key}:`, JSON.stringify(searchData[key]).slice(0, 300))
          }
        }
      }
    } else if (searchData.error) {
      response = `Google AI Mode error: ${searchData.error}`
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
      JSON.stringify({
        response: `Google AI Mode temporary error: ${error.message}`,
        citations: []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
