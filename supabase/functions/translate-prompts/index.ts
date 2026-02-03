import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { getLanguageName } from "../_shared/translate-prompts.ts"

/** Max prompts per OpenAI batch to stay under token limits and timeouts */
const BATCH_SIZE = 25

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestBody = await req.json()
    const { prompts, countryCode } = requestBody

    if (!prompts || !Array.isArray(prompts)) {
      return new Response(
        JSON.stringify({ error: 'Prompts array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If no country or GLOBAL, return prompts as-is
    if (!countryCode || countryCode === 'GLOBAL') {
      return new Response(
        JSON.stringify({ translatedPrompts: prompts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const targetLanguage = getLanguageName(countryCode)

    // If target language is English, return as-is
    if (targetLanguage === 'English') {
      return new Response(
        JSON.stringify({ translatedPrompts: prompts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiApiKey) {
      console.warn('⚠️ OpenAI API key not configured, returning original prompts')
      return new Response(
        JSON.stringify({ translatedPrompts: prompts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🌍 Translating ${prompts.length} prompts to ${targetLanguage} (country: ${countryCode}) [batch mode]`)

    // Translate in batches via a single API call per batch (avoids 504 timeout)
    const translatedPrompts: string[] = []

    for (let i = 0; i < prompts.length; i += BATCH_SIZE) {
      const batch = prompts.slice(i, i + BATCH_SIZE)
      const batchIndex = batch.map((p: string, j: number) => `${j + 1}. ${p}`).join('\n')

      const systemPrompt = `You are a translator. Translate each numbered item to ${targetLanguage}. Preserve meaning, tone, and structure. Keep company names, industry names, and proper nouns unchanged. Reply ONLY with a valid JSON object: {"translations": ["item1 translation", "item2 translation", ...]} with exactly ${batch.length} strings in the same order. No other text.`

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Translate these ${batch.length} items:\n${batchIndex}` },
          ],
          max_tokens: 4096,
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.warn(`⚠️ Batch translation failed: ${response.status} - ${errText}`)
        batch.forEach((p: string) => translatedPrompts.push(p))
        continue
      }

      const data = await response.json()
      const raw = data.choices?.[0]?.message?.content?.trim()

      if (!raw) {
        batch.forEach((p: string) => translatedPrompts.push(p))
        continue
      }

      try {
        const parsed = JSON.parse(raw) as { translations?: string[] }
        const list = parsed?.translations
        if (Array.isArray(list) && list.length >= batch.length) {
          for (let k = 0; k < batch.length; k++) {
            const t = list[k]
            const cleaned = (typeof t === 'string' ? t : String(t)).replace(/^["']|["']$/g, '').trim()
            translatedPrompts.push(cleaned || batch[k])
          }
        } else {
          batch.forEach((p: string) => translatedPrompts.push(p))
        }
      } catch (parseErr) {
        console.warn('⚠️ Batch JSON parse failed:', parseErr)
        batch.forEach((p: string) => translatedPrompts.push(p))
      }
    }

    console.log(`✅ Translated ${translatedPrompts.length} prompts to ${targetLanguage}`)

    return new Response(
      JSON.stringify({
        translatedPrompts,
        targetLanguage,
        countryCode,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('❌ Error in translate-prompts function:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        translatedPrompts: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})


