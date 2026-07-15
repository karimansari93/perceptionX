// Shared theme extraction used by three paths that must never drift:
//   - ai-thematic-analysis        (real-time, one response, fire-and-forget)
//   - ai-thematic-analysis-bulk   (admin backfill panel + safety-net cron)
//   - theme-backfill-tick         (cron: picks missing responses, fans out
//                                  to ai-thematic-analysis-bulk)
// The prompt, schema, model, and validation live here; buildMessageParams()
// is the single source of truth for the request shape so any batched or
// synchronous call is byte-identical.
//
// Backed by Claude Haiku 4.5 with `output_config.format` JSON-schema mode.
// Cost: $1/$5 per 1M input/output tokens — the cheapest Claude model.
// Output tokens dominate spend, so the prompt caps theme count and field
// lengths.
//
// MODEL CHOICE — 2026-07-15: a Gemini 2.5 Flash-Lite swap was trialled for
// cost (~11x cheaper output) but reverted. On a positive/total sentiment
// metric it ran ~46% neutral vs Haiku's ~18%, which would have shifted the
// sentiment methodology as themes accumulated. Data-methodology continuity
// outweighs the model saving here; Haiku is the calibration of record. The
// upstream cost levers that are model-independent stay in place: callers
// only theme when company_mentioned = true, and find_responses_missing_themes
// applies the same filter plus themes_none_found_at IS NULL.
//
// NOTE on prompt caching: the cache_control marker below is currently a
// no-op — Haiku 4.5's minimum cacheable prefix is 4096 tokens and this
// system prompt is ~1K. It is kept (harmless) so caching engages
// automatically if the prompt ever grows past the threshold.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.65.0";

// @ts-ignore Deno global is available in the edge runtime.
// Env var is CLAUDE_API_KEY (matches the existing test-prompt-claude function
// — the platform's secret is stored under that name, not ANTHROPIC_API_KEY).
const client = new Anthropic({ apiKey: Deno.env.get("CLAUDE_API_KEY") });

export const MODEL = "claude-haiku-4-5";
export const MAX_TOKENS = 4096;

export interface AITheme {
  theme_name: string;
  theme_description: string;
  sentiment: "positive" | "negative" | "neutral";
  sentiment_score: number;
  attribute_id: string;
  attribute_name: string;
  confidence_score: number;
  keywords: string[];
  context_snippets: string[];
}

const V2_ATTRIBUTES: Record<string, string> = {
  "mission-purpose-impact": "Mission, Purpose & Impact",
  "compensation": "Compensation",
  "company-culture": "Company Culture",
  "leadership": "Leadership",
  "job-security": "Job Security",
  "career-opportunities": "Career Opportunities",
  "wellbeing-balance": "Wellbeing & Balance",
  "inclusion": "Inclusion",
  "innovation": "Innovation",
  "application-communication": "Application & Communication",
  "candidate-feedback": "Candidate Feedback",
  "interview-experience": "Interview Experience",
  "onboarding-experience": "Onboarding",
};
const V2_ATTRIBUTE_IDS = Object.keys(V2_ATTRIBUTES);

const LEGACY_ATTRIBUTE_MAP: Record<string, string | null> = {
  "mission-purpose": "mission-purpose-impact",
  "social-impact": "mission-purpose-impact",
  "rewards-recognition": "compensation",
  "security-perks": "job-security",
  "application-process": "application-communication",
  "candidate-communication": "application-communication",
  "overall-candidate-experience": null,
};

export const THEME_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      theme_name: { type: "string" },
      theme_description: { type: "string" },
      sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
      sentiment_score: { type: "number" },
      attribute_id: { type: "string", enum: V2_ATTRIBUTE_IDS },
      attribute_name: { type: "string" },
      confidence_score: { type: "number" },
      keywords: { type: "array", items: { type: "string" } },
      context_snippets: { type: "array", items: { type: "string" } },
    },
    required: [
      "theme_name",
      "theme_description",
      "sentiment",
      "sentiment_score",
      "attribute_id",
      "attribute_name",
      "confidence_score",
      "keywords",
      "context_snippets",
    ],
    additionalProperties: false,
  },
} as const;

export const SYSTEM_PROMPT = `You are an expert in analyzing AI-generated responses to extract themes about a company's employer brand and talent perception.

For each theme you identify, output an object with:
- theme_name: clear, concise name (max 6 words)
- theme_description: ONE sentence, max 20 words
- sentiment: "positive", "negative", or "neutral"
- sentiment_score: number from -1 (very negative) to 1 (very positive)
- attribute_id: exactly one of these strings (definition in parentheses):
  mission-purpose-impact (mission, values, purpose, and social/ESG/community impact),
  compensation (pay, salary, bonuses, benefits, and perks),
  company-culture (workplace atmosphere, team dynamics, work environment, and whether employees feel valued/recognized),
  leadership (managers and senior leadership quality and management style),
  job-security (employment stability, tenure, layoff risk — stability ONLY, not pay/perks),
  career-opportunities (career growth, development, learning, and promotions),
  wellbeing-balance (work-life balance, flexibility, remote/hybrid work, and wellbeing),
  inclusion (diversity, equity, and inclusion),
  innovation (innovation culture and access to new technology),
  application-communication (the application process AND recruiter/candidate communication),
  candidate-feedback (feedback given to candidates after applying or interviewing),
  interview-experience (the interview process and preparation),
  onboarding-experience (new-hire onboarding and first months)
- attribute_name: human-readable form (e.g. "Mission, Purpose & Impact", "Company Culture", "Job Security")
- confidence_score: number from 0 to 1
- keywords: 3-5 keywords drawn from the response, each 1-3 words
- context_snippets: 1-2 verbatim snippets from the response that support the theme, each max 20 words (truncate longer passages with "...")

Classification rules — be strict:
- company-culture is ONLY for workplace atmosphere, team dynamics, cultural practices, work environment, and feeling valued/recognized
- Mission, values, purpose, and social/community impact belong to mission-purpose-impact, NOT company-culture
- Pay, benefits, and perks belong to compensation, NOT company-culture; job stability/layoffs belong to job-security, NOT compensation
- Work-life balance, mental health, flexibility, and remote work belong to wellbeing-balance, NOT company-culture
- Candidate-journey topics belong to the dedicated candidate-experience attributes: the application process and recruiter communication → application-communication; interviews → interview-experience; post-interview/application feedback → candidate-feedback; onboarding → onboarding-experience

Coverage and concision:
- Look for both positive and negative themes
- Return 2-6 themes for a typical response. Merge closely related points into one theme per attribute-sentiment pair rather than fragmenting them; do not pad with marginal themes
- If the response contains ANY information about the named company — even if it also discusses competitors or comparisons — extract themes from that information
- Only return an empty array if the response truly contains no information about the company at all`;

function normalizeAttributeId(raw: any): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (id in V2_ATTRIBUTES) return id;
  if (id in LEGACY_ATTRIBUTE_MAP) return LEGACY_ATTRIBUTE_MAP[id] ?? "unknown";
  return "unknown";
}

export function validateAndCleanTheme(t: any): AITheme {
  const attributeId = normalizeAttributeId(t?.attribute_id);
  return {
    theme_name: t?.theme_name || "Unnamed Theme",
    theme_description: t?.theme_description || "",
    sentiment: ["positive", "negative", "neutral"].includes(t?.sentiment) ? t.sentiment : "neutral",
    sentiment_score: Math.max(-1, Math.min(1, parseFloat(t?.sentiment_score) || 0)),
    attribute_id: attributeId,
    attribute_name: V2_ATTRIBUTES[attributeId] || t?.attribute_name || "Unknown Attribute",
    confidence_score: Math.max(0, Math.min(1, parseFloat(t?.confidence_score) || 0)),
    keywords: Array.isArray(t?.keywords) ? t.keywords : [],
    context_snippets: Array.isArray(t?.context_snippets) ? t.context_snippets : [],
  };
}

// Single source of truth for the Messages request shape.
export function buildMessageParams(responseText: string, companyName: string) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: THEME_SCHEMA },
    },
    messages: [
      {
        role: "user" as const,
        content: `Analyze this response about "${companyName}":\n\n"""\n${responseText}\n"""`,
      },
    ],
  };
}

// Parse a Messages API response into validated themes. Returns [] on any
// malformed output rather than throwing — a response with no themes is
// retried by the safety-net cron, so failing soft is safe.
export function parseThemesFromMessage(response: any, label: string): AITheme[] {
  const textBlock = response?.content?.find((b: any) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!textBlock) {
    console.warn(`[theme-analysis] no text block (${label}). stop_reason=${response?.stop_reason}`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    console.error(`[theme-analysis] JSON parse failed despite structured output (${label}):`, e, textBlock.text.slice(0, 200));
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn(`[theme-analysis] structured output returned non-array (${label}):`, textBlock.text.slice(0, 200));
    return [];
  }

  return parsed.map(validateAndCleanTheme);
}

export async function analyzeThemes(
  responseText: string,
  companyName: string,
): Promise<AITheme[]> {
  try {
    const response = await client.messages.create(
      buildMessageParams(responseText, companyName) as any,
    );

    const themes = parseThemesFromMessage(response, companyName);
    if (themes.length === 0) {
      console.warn(`[theme-analysis] EMPTY for "${companyName}". Input head: ${responseText.slice(0, 150)}`);
    } else {
      console.log(`[theme-analysis] ${themes.length} themes for "${companyName}". cache_read=${response.usage?.cache_read_input_tokens ?? 0} cache_write=${response.usage?.cache_creation_input_tokens ?? 0}`);
    }
    return themes;
  } catch (e: any) {
    if (e instanceof Anthropic.RateLimitError) {
      throw new Error(`Claude rate-limited (429): ${e.message}`);
    }
    if (e instanceof Anthropic.APIError) {
      throw new Error(`Claude API error ${e.status}: ${e.message}`);
    }
    throw e;
  }
}
