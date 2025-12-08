import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from "../_shared/cors.ts"
import { getLanguageName } from "../_shared/translate-prompts.ts"

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

    console.log(`🌍 Translating ${prompts.length} prompts to ${targetLanguage} (country: ${countryCode})`)

    // Translate all prompts
    const translatedPrompts: string[] = []
    
    for (const prompt of prompts) {
      try {
        const translationPrompt = `Translate the following question/prompt to ${targetLanguage}. 
Preserve the meaning, tone, and structure. Keep company names, industry names, and proper nouns unchanged.
Only translate the question structure and common words.

Original prompt: "${prompt}"

Translated prompt:`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini', // Using mini for cost efficiency
            messages: [
              {
                role: 'user',
                content: translationPrompt
              }
            ],
            temperature: 0.3,
            max_tokens: 200
          })
        });

        if (!response.ok) {
          console.warn(`⚠️ Translation failed for prompt: ${prompt.substring(0, 50)}...`);
          translatedPrompts.push(prompt); // Use original on error
          continue;
        }

        const data = await response.json();
        const translated = data.choices[0]?.message?.content?.trim();

        if (translated && translated.length > 0) {
          // Clean up any quotes that might wrap the translation
          const cleaned = translated.replace(/^["']|["']$/g, '').trim();
          translatedPrompts.push(cleaned);
          console.log(`✅ Translated: "${prompt.substring(0, 50)}..." → "${cleaned.substring(0, 50)}..."`)
        } else {
          translatedPrompts.push(prompt); // Use original if translation failed
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.warn(`⚠️ Translation error for prompt: ${error.message}`);
        translatedPrompts.push(prompt); // Use original on error
      }
    }

    console.log(`✅ Translated ${translatedPrompts.length} prompts to ${targetLanguage}`)

    return new Response(
      JSON.stringify({ 
        translatedPrompts,
        targetLanguage,
        countryCode
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('❌ Error in translate-prompts function:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        translatedPrompts: [] 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})


