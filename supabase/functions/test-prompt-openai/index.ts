import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { SOURCES_SECTION_REGEX, unwrapTranslateUrl } from "../_shared/citation-extraction.ts"

// Primary model: rolling `gpt-5.5` so we stay aligned with the model ChatGPT
// actually serves by default (GPT-5.5 Instant became the ChatGPT default on
// 2026-05-05). For GEO measurement, matching the live ChatGPT model is the
// point — citations only mean something if they reflect what real users see.
const PRIMARY_MODEL = 'gpt-5.5'
// Fallbacks tried only if the primary is unavailable (e.g. future deprecation),
// preserving the original "never silently degrade" intent while staying robust.
const MODEL_FALLBACKS = ['gpt-5.2', 'gpt-4.1']

const SYSTEM_INSTRUCTIONS =
  `You are a research assistant providing well-sourced, up-to-date information ` +
  `about companies and their reputation as employers. Use web search to ground ` +
  `your answer in current sources, and cite the specific pages you rely on.`

// Tracking params various sources (and OpenAI's web_search, which appends
// `utm_source=openai`) add to citation URLs. Stripping them keeps
// url_recency_cache matching and domain analytics consistent with how the rest
// of the pipeline stores citations.
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'msockid', 'ncid', 'fbclid', 'gclid',
]

function normalizeCitationUrl(rawUrl: string): string {
  const unwrapped = unwrapTranslateUrl(rawUrl)
  try {
    const u = new URL(unwrapped)
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p))
    return u.toString()
  } catch {
    return unwrapped
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

// Exponential backoff retry for rate limit errors
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  initialDelay = 1000,
): Promise<T> {
  let lastError: any
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      const isRateLimit =
        error?.status === 429 ||
        error?.response?.status === 429 ||
        error?.message?.includes('rate limit') ||
        error?.message?.includes('429')
      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000
        console.log(`Rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  throw lastError
}

/**
 * Parse the OpenAI Responses API payload.
 *
 * The output is a flat array; we want the assistant `message` item's
 * `output_text` content. Each output_text block carries `url_citation`
 * annotations — these are OpenAI's NATIVE, real, retrieved citations (the
 * analogue of Claude's web_search_result_location blocks). Indices on each
 * annotation are relative to that block's own text, so we resolve cited_text
 * per-block before concatenating.
 */
function parseResponsesOutput(data: any): {
  response: string
  citations: any[]
  webSearchCalls: number
} {
  const outputs: any[] = Array.isArray(data?.output) ? data.output : []
  const blocks: string[] = []
  const citations: any[] = []
  const seen = new Set<string>()
  let webSearchCalls = 0

  for (const item of outputs) {
    if (item?.type === 'web_search_call') webSearchCalls++
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue

    for (const c of item.content) {
      if (c?.type !== 'output_text' || typeof c.text !== 'string') continue
      const blockText: string = c.text
      blocks.push(blockText)

      const annotations: any[] = Array.isArray(c.annotations) ? c.annotations : []
      for (const a of annotations) {
        if (a?.type !== 'url_citation' || !a.url) continue
        const url = normalizeCitationUrl(a.url)
        if (seen.has(url)) continue
        seen.add(url)

        let cited_text: string | undefined
        if (Number.isInteger(a.start_index) && Number.isInteger(a.end_index) && a.end_index > a.start_index) {
          cited_text = blockText.slice(a.start_index, a.end_index)
        }

        const domain = domainOf(url)
        citations.push({
          url,
          domain,
          title: a.title || `Source from ${domain}`,
          ...(cited_text ? { cited_text } : {}),
          type: 'website',
          confidence: 'high',
        })
      }
    }
  }

  let response = blocks.join('\n')
  if (!response && typeof data?.output_text === 'string') {
    response = data.output_text
  }

  // Fallback supplement: if the model also listed URLs in a "Sources" section
  // (any supported language) that weren't annotated, capture those too. With
  // native web search this is rare, but it costs nothing and preserves the
  // multilingual source-section handling the pipeline already relied on.
  const sourcesMatch = response.match(SOURCES_SECTION_REGEX)
  if (sourcesMatch) {
    const sourceUrls = sourcesMatch[1].match(/https?:\/\/[^\s\n\)]+/g) || []
    for (const raw of sourceUrls) {
      const url = normalizeCitationUrl(raw.replace(/[.,;:!?]+$/, ''))
      if (seen.has(url)) continue
      seen.add(url)
      const domain = domainOf(url)
      citations.push({ url, domain, title: `Source from ${domain}`, type: 'website', confidence: 'medium' })
    }
  }

  return { response, citations, webSearchCalls }
}

// Call the OpenAI Responses API. With web search enabled, citations are real,
// retrievable sources rather than model-recalled guesses. Web search is opt-out
// (default on) so the GEO data-collection paths get grounded citations
// automatically; utility callers (summaries, language detect/translate) pass
// enableWebSearch:false to keep those calls fast and cheap.
async function callOpenAIWebSearch(prompt: string, useWebSearch: boolean): Promise<{
  response: string
  citations: any[]
  webSearchCalls: number
  model: string
  usage: any
}> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const models = [PRIMARY_MODEL, ...MODEL_FALLBACKS]
  let lastError: any

  for (const model of models) {
    try {
      return await retryWithBackoff(async () => {
        const body: Record<string, any> = {
          model,
          instructions: useWebSearch ? SYSTEM_INSTRUCTIONS : undefined,
          input: prompt,
          max_output_tokens: useWebSearch ? 4000 : 2000,
          // Low effort keeps grounded answers close to ChatGPT's default
          // "Instant" experience and within the edge-function time budget;
          // minimal effort keeps the no-search utility calls fast. Only the
          // reasoning (gpt-5.x) models accept this parameter.
          ...(model.startsWith('gpt-5')
            ? { reasoning: { effort: useWebSearch ? 'low' : 'minimal' } }
            : {}),
          // search_context_size 'low' keeps real search + url_citation sources
          // while cutting the dominant input-token cost (the retrieved page
          // content). We care about which sources are cited, not deep synthesis.
          ...(useWebSearch ? { tools: [{ type: 'web_search', search_context_size: 'low' }] } : {}),
        }

        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })

        const data = await res.json()

        if (!res.ok) {
          const err: any = new Error(data?.error?.message || `OpenAI API error: ${res.status}`)
          err.status = res.status
          throw err
        }

        const { response, citations, webSearchCalls } = parseResponsesOutput(data)
        if (!response) {
          throw new Error(`No text in Responses output (status=${data?.status})`)
        }

        console.log(`✅ ${model}: ${response.length} chars, ${citations.length} citations, ${webSearchCalls} web searches`)
        return { response, citations, webSearchCalls, model: data.model || model, usage: data.usage }
      })
    } catch (error: any) {
      console.error(`❌ Model ${model} failed:`, error?.message)
      lastError = error
      // Non-rate-limit failure: try the next model in the chain.
      if (error?.status !== 429) continue
      throw error
    }
  }

  throw new Error(`All OpenAI models failed. Last error: ${lastError?.message}`)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
    })
  }

  try {
    // enableWebSearch defaults true so GEO collection gets grounded citations.
    // `batch` is accepted as an alias to disable web search, mirroring the
    // Claude function's contract.
    const { prompt, enableWebSearch = true, batch = false } = await req.json()
    if (!prompt) throw new Error('Prompt is required')

    const useWebSearch = enableWebSearch && !batch
    const result = await callOpenAIWebSearch(prompt, useWebSearch)

    return new Response(
      JSON.stringify({
        response: result.response,
        citations: result.citations,
        webSearchEnabled: useWebSearch,
        webSearchCalls: result.webSearchCalls,
        model: result.model,
        usage: result.usage,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
