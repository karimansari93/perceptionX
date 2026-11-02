import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { claudeFetch } from "../_shared/claude-keys.ts";

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

    // Call Claude to detect companies
    const systemPrompt = isIndustryWide
      ? `You are a helpful assistant that identifies ALL company names mentioned in text.
Return ONLY a comma-separated list of ALL company names mentioned in the text, nothing else.

IMPORTANT FORMAT RULES:
- Return ONLY the company names separated by commas, nothing else
- Do not include any explanatory text, prefixes, or suffixes
- Use proper company name capitalization (e.g., "IBM" not "Ibm", "Salesforce" not "salesforce")
- Include ALL companies mentioned, not just competitors
- If no companies are found, return an empty string
- Do not include phrases like "None" or "No companies found"

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

Example valid responses:
"IBM, Salesforce, Oracle, Microsoft"
"Procter & Gamble, Unilever, Nestlé, Coca-Cola"
"" (empty string if no companies found)

Example invalid responses:
"None"
"No companies found"
"Companies include: IBM, Salesforce"
"Some companies are IBM, Salesforce"`
      : `You are a helpful assistant that identifies company names from text.
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
"Some competitors are IBM, Salesforce"`;

    const userPrompt = isIndustryWide
      ? `In the following text, identify EVERY company name that is mentioned. You must list ALL companies mentioned, not just a few. Return ONLY a comma-separated list of company names with proper capitalization, nothing else:\n\n${response}`
      : `In the following text, identify all company names that are mentioned as competitors or alternatives to "${companyName}". Return ONLY a comma-separated list of company names with proper capitalization, nothing else:\n\n${response}`;

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