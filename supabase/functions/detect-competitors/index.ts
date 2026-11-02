import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { claudeFetch } from "../_shared/claude-keys.ts";
import { competitorPrompts } from "../_shared/competitor-prompt.ts";

const MODEL = "claude-haiku-5-5";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? ''
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { response, companyName } = await req.json();

    if (!response) {
      return new Response(
        JSON.stringify({ error: 'response is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Determine if this is for industry-wide extraction (no companyName) or competitor detection
    const isIndustryWide = !companyName || companyName.trim() === '';

    const { systemPrompt, userPrompt } = competitorPrompts(response, companyName);

    // Claude Haiku, thinking off. Was OpenAI gpt-4.1-nano until OpenAI retired
    // it (404 model_not_found from 2026-10-23), which left detected_competitors
    // null on every answer collected after that. Haiku 5.5 only accepts its
    // default sampling, so no temperature.
    const claudeResponse = await claudeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: isIndustryWide ? 500 : 200,
        thinking: { type: 'disabled' },
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error(`Claude error ${claudeResponse.status}: ${errBody}`);
      return new Response(
        JSON.stringify({ error: 'claude_error', status: claudeResponse.status, body: errBody }),
        { status: 502, headers: corsHeaders }
      );
    }

    const data = await claudeResponse.json();
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');
    // Haiku answers "return an empty string" with no text block at all, so a
    // finished turn with no text means no competitors, not a failure.
    if (textBlocks.length === 0 && data.stop_reason === 'end_turn') {
      return new Response(
        JSON.stringify({ detectedCompetitors: '' }),
        { headers: corsHeaders }
      );
    }
    if (textBlocks.length === 0) {
      console.error('Claude returned no content:', JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: 'claude_no_content', raw: data }),
        { status: 502, headers: corsHeaders }
      );
    }
    let detectedCompetitors = textBlocks.map((b: any) => b.text).join('').trim();

    // Filter out responses that indicate no competitors were found
    if (
      detectedCompetitors.includes("There are no specific company names mentioned as competitors or alternatives") ||
      detectedCompetitors.includes("Some companies mentioned as competitors or alternatives")
    ) {
      detectedCompetitors = '';
    }

    return new Response(
      JSON.stringify({ detectedCompetitors }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to detect competitors' }),
      { status: 500, headers: corsHeaders }
    );
  }
}); 