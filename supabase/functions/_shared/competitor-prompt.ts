// Prompts for detect-competitors (Claude Haiku). Shared with
// scripts/compare-competitor-detection.mjs so a comparison run tests exactly
// what production sends. Plain TypeScript, no Deno APIs.
//
// No companyName: list every company in the text (industry-wide extraction).
// With companyName: list the competitors of that company as an employer.

export function competitorPrompts(
  response: string,
  companyName?: string,
): { systemPrompt: string; userPrompt: string } {
  const isIndustryWide = !companyName || companyName.trim() === '';

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
Return ONLY a comma-separated list of company names that are competitors or alternatives to "${companyName}" as an employer in the same industry or market.

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

  return { systemPrompt, userPrompt };
}

// The filter analyze-response applies to detect-competitors' output before it
// stores detected_competitors (analyze-response keeps its own inline copy).
export function filterCompetitorNames(raw: string, companyName: string): string {
  const stopwords = new Set([
    "other", "others", "equal", "training", "development", "skills", "school", "its", "the", "and", "or",
    "companies", "company", "co", "inc", "llc", "ltd",
  ]);
  return raw
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .filter((n) => !/\bother\b/i.test(n) || /\bother\b/i.test(companyName) === false)
    .filter((n) => /[A-Z]/.test(n))
    .filter((n) => !stopwords.has(n.toLowerCase()))
    .slice(0, 10)
    .join(", ");
}

// Haiku does not always answer with a bare list: in the July comparison
// (2026-11-02, 100 CSL Behring answers) 15 replies were a sentence explaining
// there were none, "None", the literal "(empty string)", or a job site. A reply
// that is not a plain list of names is stored as none found, and job sites and
// review sites the prompt already excludes are dropped.
const NOT_A_LIST = /^(none|n\/a|no competitors( found)?)\.?$|\bempty (string|list)\b/i;
const EXCLUDED_SITES = /^(glassdoor|indeed|linkedin|seek|kununu|levels\.fyi|reddit|ambitionbox|comparably|jobs\.ch)$/i;

export function cleanCompetitorReply(raw: string): string {
  const reply = raw.trim().replace(/^"|"$/g, '').trim();
  if (!reply || NOT_A_LIST.test(reply)) return '';
  const names = reply.split(',').map((n) => n.trim()).filter(Boolean);
  // A sentence, not a list: a long item, or sentence punctuation inside one.
  if (names.some((n) => n.split(/\s+/).length > 6 || /[.!?:]\s|\n/.test(n))) return '';
  return names.filter((n) => !EXCLUDED_SITES.test(n) && !NOT_A_LIST.test(n)).join(', ');
}
