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

    // Build the LLM prompt
    const prompt = `For the following text, extract all companies mentioned. For each company, list the themes or aspects discussed in relation to that company, and classify each theme as positive, negative, or neutral. Output as a JSON array with this structure: [{\"company\": \"...\", \"themes\": [{\"theme\": \"...\", \"sentiment\": \"positive|negative|neutral\"}]}]. Only include companies that are actually mentioned in the text.\n\nText:\n${text}`;

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_completion_tokens: 1500 // GPT-5.2 uses tokens for reasoning + content
        // Note: GPT-5.2 doesn't support custom temperature, uses default (1)
      }),
    });

    const data = await openaiResponse.json();
    if (!openaiResponse.ok) {
      throw new Error(data.error?.message || 'OpenAI API error');
    }

    // Try to parse the JSON from the LLM response
    let companies: any[] = [];
    try {
      companies = JSON.parse(data.choices?.[0]?.message?.content || '[]');
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Failed to parse LLM output as JSON.", raw: data.choices?.[0]?.message?.content }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Optionally, calculate sentiment score per company
    companies = companies.map((c: any) => {
      const pos = c.themes.filter((t: any) => t.sentiment === 'positive').length;
      const neg = c.themes.filter((t: any) => t.sentiment === 'negative').length;
      const total = pos + neg;
      return {
        ...c,
        sentiment_score: total > 0 ? Math.round((pos / total) * 1000) / 10 : null // e.g. 66.7
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