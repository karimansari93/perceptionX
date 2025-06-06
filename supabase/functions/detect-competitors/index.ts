import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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

    if (!response || !companyName) {
      return new Response(
        JSON.stringify({ error: 'response and companyName are required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Call OpenAI to detect competitors
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant that identifies company names from text.
Return only a comma-separated list of company names that are direct competitors or alternatives to "${companyName}" in the same industry or market.
Do NOT include job boards, review sites, or information sources such as Glassdoor, Indeed, LinkedIn, Monster, CareerBuilder, ZipRecruiter, or similar companies.
Exclude the main company name itself.
If no competitors are found, return an empty string.`
          },
          {
            role: 'user',
            content: `In the following text, identify all company names that are mentioned as competitors or alternatives to "${companyName}". Return ONLY a comma-separated list of company names, nothing else:\n\n${response}`
          }
        ],
        temperature: 0.2,
        max_tokens: 100
      })
    });

    const data = await openAIResponse.json();
    const detectedCompetitors = data.choices?.[0]?.message?.content?.trim() || '';

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