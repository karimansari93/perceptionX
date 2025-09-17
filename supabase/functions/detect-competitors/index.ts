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
Return ONLY a comma-separated list of company names that are direct competitors or alternatives to "${companyName}" in the same industry or market.

IMPORTANT FORMAT RULES:
- Return ONLY the company names separated by commas, nothing else
- Do not include any explanatory text, prefixes, or suffixes
- Use proper company name capitalization (e.g., "IBM" not "Ibm", "Salesforce" not "salesforce")
- If no competitors are found, return an empty string
- Do not include phrases like "None" or "No competitors found"

A competitor is defined as:
- A company that offers similar products/services in the same market
- A company that competes for the same customers
- A company that operates in the same industry segment

Do NOT include:
- Job boards (Glassdoor, Indeed, AmbitionBox, LinkedIn, Monster, CareerBuilder, ZipRecruiter, etc.)
- Review sites (Trustpilot, G2, Capterra, etc.)
- News sources (Reuters, Bloomberg, etc.)
- Social media platforms (Twitter, Facebook, etc.)
- Information aggregators (Crunchbase, PitchBook, etc.)
- Market research firms (Gartner, Forrester, etc.)
- Industry associations or organizations
- Government agencies or regulatory bodies
- Educational institutions
- Consulting firms or agencies
- The word "None" or any variation of it

Exclude the main company name itself.

Example valid responses:
"IBM, Salesforce, Oracle"
"Microsoft, Apple, Google"
"" (empty string if no competitors found)

Example invalid responses:
"None"
"No competitors found"
"Competitors include: IBM, Salesforce"
"Some competitors are IBM, Salesforce"`
          },
          {
            role: 'user',
            content: `In the following text, identify all company names that are mentioned as competitors or alternatives to "${companyName}". Return ONLY a comma-separated list of company names with proper capitalization, nothing else:\n\n${response}`
          }
        ],
        temperature: 0.2,
        max_tokens: 100
      })
    });

    const data = await openAIResponse.json();
    let detectedCompetitors = data.choices?.[0]?.message?.content?.trim() || '';

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