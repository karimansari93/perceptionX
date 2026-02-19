// @ts-ignore: Deno.env and Deno imports are available in Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();
    if (!text) {
      return new Response(
        JSON.stringify({ error: "Missing 'text' in request body." }),
        { status: 400, headers: corsHeaders }
      );
    }

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured');
    }

    const prompt = `For the following text, extract all companies mentioned. For each company, list the themes or aspects discussed in relation to that company, and classify each theme as positive, negative, or neutral. Output as a JSON array with this structure: [{"company": "...", "themes": [{"theme": "...", "sentiment": "positive|negative|neutral"}]}]. Only include companies that are actually mentioned in the text. Return ONLY the JSON array, no other text.\n\nText:\n${text}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    const data = await claudeResponse.json();
    if (!claudeResponse.ok) {
      if (data.error?.type === 'rate_limit_error') {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please wait and try again.', retryAfter: 60000 }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' } }
        );
      }
      throw new Error(data.error?.message || `Claude API error: ${claudeResponse.status}`);
    }

    const rawContent = data.content?.[0]?.text || '[]';

    let companies: any[] = [];
    try {
      const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
      companies = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Failed to parse LLM output as JSON.", raw: rawContent }),
        { status: 500, headers: corsHeaders }
      );
    }

    companies = companies.map((c: any) => {
      const pos = c.themes.filter((t: any) => t.sentiment === 'positive').length;
      const total = c.themes.length;
      return {
        ...c,
        sentiment_score: total > 0 ? Math.round((pos / total) * 1000) / 10 : null,
      };
    });

    return new Response(
      JSON.stringify({ companies }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}); 