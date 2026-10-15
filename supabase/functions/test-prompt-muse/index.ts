import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { SOURCES_SECTION_REGEX, unwrapTranslateUrl } from "../_shared/citation-extraction.ts"
import { COUNTRY_NAME_TO_CODE } from "../_shared/countries.ts"

// Meta Muse via the Meta Model API (https://dev.meta.ai/docs). Muse Spark is
// the text model behind Meta AI. We use Standard mode, never the discounted
// "-contributor" variants: Contributor mode grants Meta the right to train on
// request content, and our prompts name clients.
const PRIMARY_MODEL = 'muse-spark-1.3'
const MODEL_FALLBACKS = ['muse-spark-1.2']

const API_URL = 'https://api.meta.ai/v1/responses'

// Prompt caching is automatic on the Model API; these two hints raise the hit
// rate on the fixed prefix (tool definitions + our instructions, ~4k tokens).
// One stable key for all collection traffic, never per company or per run, and
// 24h retention so a collection spread over hours keeps hitting the cache.
const PROMPT_CACHE_KEY = 'perceptionx-collection'
const PROMPT_CACHE_RETENTION = '24h'

// Same soft search cap and instructions as test-prompt-openai, so the two
// Responses-API models are collected under comparable conditions.
const MAX_WEB_SEARCHES = 2

const SYSTEM_INSTRUCTIONS =
  `You are a research assistant providing well-sourced, up-to-date information ` +
  `about companies and their reputation as employers. Use web search to ground ` +
  `your answer in current sources, and cite the specific pages you rely on. ` +
  `Use at most ${MAX_WEB_SEARCHES} web searches; pick the most authoritative ` +
  `sources rather than searching broadly.`

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

// Prompt location_context ("United Kingdom", "GB", "Global (All Countries)")
// to an ISO country code for web_search user_location; null means no targeting.
function locationToCountry(location: string | null | undefined): string | null {
  const trimmed = location?.trim()
  if (!trimmed || /^global/i.test(trimmed)) return null
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  const code = COUNTRY_NAME_TO_CODE[trimmed] || COUNTRY_NAME_TO_CODE[trimmed.replace(/^the\s+/i, '')]
  return code ? code.toUpperCase() : null
}

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
      const retryable = error?.status === 429 || error?.status >= 500
      if (retryable && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000
        console.log(`Muse ${error?.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  throw lastError
}

/**
 * Parse the Responses API payload. Muse returns the same shape as OpenAI:
 * `web_search_call` items, then a `message` whose `output_text` blocks carry
 * `url_citation` annotations (the sources the answer actually cites).
 * With include=["web_search_call.results"], each web_search_call also lists
 * every page the model looked at; we return those separately as
 * `sourcesConsidered` and never mix them into `citations`.
 *
 * Muse narrates between searches ("I'll research...", "Now I'll open the
 * pages..."), each as its own message item. Only messages after the last
 * web_search_call are the answer; earlier ones would pollute sentiment and
 * theming. Citations are still collected from every block.
 */
function parseResponsesOutput(data: any): {
  response: string
  citations: any[]
  sourcesConsidered: any[]
  webSearchCalls: number
} {
  const outputs: any[] = Array.isArray(data?.output) ? data.output : []
  const blocks: { text: string; idx: number }[] = []
  const citations: any[] = []
  const sourcesConsidered: any[] = []
  const seen = new Set<string>()
  const seenConsidered = new Set<string>()
  let webSearchCalls = 0
  let lastSearchIdx = -1

  for (const [idx, item] of outputs.entries()) {
    if (item?.type === 'web_search_call') {
      webSearchCalls++
      lastSearchIdx = idx
      for (const r of Array.isArray(item.results) ? item.results : []) {
        if (!r?.url) continue
        const url = normalizeCitationUrl(r.url)
        if (seenConsidered.has(url)) continue
        seenConsidered.add(url)
        sourcesConsidered.push({ url, domain: domainOf(url), title: r.title || null })
      }
    }
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue

    for (const c of item.content) {
      if (c?.type !== 'output_text' || typeof c.text !== 'string') continue
      const blockText: string = c.text
      blocks.push({ text: blockText, idx })

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

  const answerBlocks = blocks.filter((b) => b.idx > lastSearchIdx)
  let response = (answerBlocks.length ? answerBlocks : blocks).map((b) => b.text).join('\n')
  if (!response && typeof data?.output_text === 'string') {
    response = data.output_text
  }

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

  return { response, citations, sourcesConsidered, webSearchCalls }
}

async function callMuse(
  prompt: string,
  useWebSearch: boolean,
  country: string | null,
  modelOverride?: string,
): Promise<{
  response: string
  citations: any[]
  sourcesConsidered: any[]
  webSearchCalls: number
  model: string
  usage: any
}> {
  const apiKey = Deno.env.get('MUSE_API_KEY')
  if (!apiKey) throw new Error('MUSE_API_KEY not configured')

  const models = modelOverride ? [modelOverride] : [PRIMARY_MODEL, ...MODEL_FALLBACKS]

  const callOnce = async (model: string) => {
    const webSearchTool: Record<string, any> = { type: 'web_search', search_context_size: 'low' }
    if (country) webSearchTool.user_location = { type: 'approximate', country }

    const body: Record<string, any> = {
      model,
      instructions: useWebSearch ? SYSTEM_INSTRUCTIONS : undefined,
      input: prompt,
      max_output_tokens: useWebSearch ? 4000 : 2000,
      reasoning: { effort: 'low' },
      prompt_cache_key: PROMPT_CACHE_KEY,
      prompt_cache_retention: PROMPT_CACHE_RETENTION,
      ...(useWebSearch
        ? { tools: [webSearchTool], include: ['web_search_call.results'] }
        : {}),
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    let data: any
    try {
      data = JSON.parse(raw)
    } catch {
      const err: any = new Error(`Muse API returned non-JSON (${res.status}): ${raw.slice(0, 200)}`)
      err.status = res.status
      throw err
    }

    if (!res.ok) {
      const err: any = new Error(data?.error?.message || `Muse API error: ${res.status}`)
      err.status = res.status
      err.code = data?.error?.code
      throw err
    }

    const parsed = parseResponsesOutput(data)
    if (!parsed.response) throw new Error(`No text in Muse output (status=${data?.status})`)
    return { ...parsed, model: data.model || model, usage: data.usage }
  }

  let lastError: any
  for (const model of models) {
    try {
      return await retryWithBackoff(async () => {
        const r = await callOnce(model)
        console.log(`✅ ${model}: ${r.response.length} chars, ${r.citations.length} citations, ${r.sourcesConsidered.length} considered, ${r.webSearchCalls} searches`)
        return r
      })
    } catch (error: any) {
      console.error(`❌ Muse model ${model} failed:`, error?.message)
      lastError = error
      if (error?.status === 429) throw error
    }
  }
  throw new Error(`All Muse models failed. Last error: ${lastError?.message}`)
}

// Paid API: reject the public anon key, allow only the service role or a real
// signed-in user (same guard as test-prompt-openai).
async function isAuthorizedCaller(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (serviceKey && token === serviceKey) return true

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (anonKey && token === anonKey) return false

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    })
    if (!res.ok) return false
    const user = await res.json()
    return !!user?.id && user?.role !== 'anon'
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' },
    })
  }

  if (!(await isAuthorizedCaller(req))) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const { prompt, enableWebSearch = true, batch = false, model: modelOverride, location_context } = await req.json()
    if (!prompt) throw new Error('Prompt is required')

    const useWebSearch = enableWebSearch && !batch
    const country = locationToCountry(location_context)
    const result = await callMuse(prompt, useWebSearch, country, modelOverride)

    return new Response(
      JSON.stringify({
        response: result.response,
        citations: result.citations,
        sourcesConsidered: result.sourcesConsidered,
        webSearchEnabled: useWebSearch,
        webSearchCalls: result.webSearchCalls,
        country,
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
