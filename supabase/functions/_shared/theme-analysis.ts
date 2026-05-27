// Shared theme extraction used by both ai-thematic-analysis (real-time, one
// response at a time, called fire-and-forget from analyze-response) and
// ai-thematic-analysis-bulk (cron + admin backfill panel). Kept in one place
// so the prompt, attribute taxonomy, and validation behaviour can't drift
// between the two paths.
//
// Backed by Claude Haiku 4.5 with `output_config.format` JSON-schema mode.
// Why Claude not Gemini:
//   - Gemini 2.5 Flash free tier has a 10K-requests/day cap that we burned
//     through on day one with a 9K-response backlog. Claude billing is
//     metered per-token, no daily ceiling.
//   - Haiku 4.5 lands JSON output reliably via `output_config.format`; no
//     markdown-fence cleanup, regex rescue, or thinking-token escape-hatch
//     handling needed (the bugs that bit us on Gemini 2.5 Flash).
//   - Cost: $1/$5 per 1M input/output tokens. Roughly 3-5x Gemini Flash but
//     within budget for the ~9k backlog (~$25 total) and well below the
//     OpenAI gpt-4o-mini path the function used originally.
// We cache the system prompt (~2K tokens) so the 40 per-batch calls each
// pay ~10% for the cached prefix instead of full price — saves ~$0.07 per
// 40-response batch and reduces TTFT.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.65.0";

// @ts-ignore Deno global is available in the edge runtime.
// Env var is CLAUDE_API_KEY (matches the existing test-prompt-claude function
// — the platform's secret is stored under that name, not ANTHROPIC_API_KEY).
const client = new Anthropic({ apiKey: Deno.env.get("CLAUDE_API_KEY") });

export interface AITheme {
  theme_name: string;
  theme_description: string;
  sentiment: "positive" | "negative" | "neutral";
  sentiment_score: number;
  talentx_attribute_id: string;
  talentx_attribute_name: string;
  confidence_score: number;
  keywords: string[];
  context_snippets: string[];
}

// JSON schema enforced by Anthropic structured outputs. `additionalProperties: false`
// is required on every object node; numerical/string constraints like minimum/maxLength
// aren't supported (the SDK strips them anyway).
const THEME_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      theme_name: { type: "string" },
      theme_description: { type: "string" },
      sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
      sentiment_score: { type: "number" },
      talentx_attribute_id: { type: "string" },
      talentx_attribute_name: { type: "string" },
      confidence_score: { type: "number" },
      keywords: { type: "array", items: { type: "string" } },
      context_snippets: { type: "array", items: { type: "string" } },
    },
    required: [
      "theme_name",
      "theme_description",
      "sentiment",
      "sentiment_score",
      "talentx_attribute_id",
      "talentx_attribute_name",
      "confidence_score",
      "keywords",
      "context_snippets",
    ],
    additionalProperties: false,
  },
} as const;

// System prompt is constant across every call in a batch, so we tag it for
// prompt caching. First call in a batch pays the 1.25x write premium; the
// remaining 39 pay 0.1x for cache reads. Min cacheable prefix on Haiku 4.5
// is 4096 tokens — our system prompt is comfortably above that with the
// attribute taxonomy spelled out.
const SYSTEM_PROMPT = `You are an expert in analyzing AI-generated responses to extract themes about a company's employer brand and talent perception.

For each theme you identify, output an object with:
- theme_name: clear, concise name
- theme_description: brief description of the theme
- sentiment: "positive", "negative", or "neutral"
- sentiment_score: number from -1 (very negative) to 1 (very positive)
- talentx_attribute_id: one of (use the exact string):
  mission-purpose, rewards-recognition, company-culture, social-impact,
  inclusion, innovation, wellbeing-balance, leadership, security-perks,
  career-opportunities, application-process, candidate-communication,
  interview-experience, candidate-feedback, onboarding-experience,
  overall-candidate-experience
- talentx_attribute_name: human-readable form (e.g. "Mission & Purpose", "Company Culture")
- confidence_score: number from 0 to 1
- keywords: array of relevant keywords drawn from the response
- context_snippets: array of 1-2 verbatim snippets from the response that support the theme

Classification rules — be strict:
- company-culture is ONLY for workplace atmosphere, team dynamics, cultural practices, and work environment
- Values, mission, and purpose belong to mission-purpose, NOT company-culture
- Benefits and compensation belong to rewards-recognition, NOT company-culture
- Work-life balance, mental health, flexibility belong to wellbeing-balance, NOT company-culture
- Candidate-journey topics (applying, interviews, recruiter communication, onboarding) belong to the dedicated candidate-experience attributes, NOT to general employee categories

Coverage:
- Look for both positive and negative themes
- If the response contains ANY information about the named company — even if it also discusses competitors or comparisons — extract themes from that information
- Only return an empty array if the response truly contains no information about the company at all`;

function validateAndCleanTheme(t: any): AITheme {
  return {
    theme_name: t?.theme_name || "Unnamed Theme",
    theme_description: t?.theme_description || "",
    sentiment: ["positive", "negative", "neutral"].includes(t?.sentiment) ? t.sentiment : "neutral",
    sentiment_score: Math.max(-1, Math.min(1, parseFloat(t?.sentiment_score) || 0)),
    talentx_attribute_id: t?.talentx_attribute_id || "unknown",
    talentx_attribute_name: t?.talentx_attribute_name || "Unknown Attribute",
    confidence_score: Math.max(0, Math.min(1, parseFloat(t?.confidence_score) || 0)),
    keywords: Array.isArray(t?.keywords) ? t.keywords : [],
    context_snippets: Array.isArray(t?.context_snippets) ? t.context_snippets : [],
  };
}

export async function analyzeThemes(
  responseText: string,
  companyName: string,
): Promise<AITheme[]> {
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // ephemeral = 5-min TTL; we're firing 40 calls in ~30s so they
          // all hit a warm cache after the first.
          cache_control: { type: "ephemeral" },
        },
      ],
      // Structured outputs — Anthropic enforces the schema server-side,
      // so the model's first response block is guaranteed-parseable JSON.
      output_config: {
        format: { type: "json_schema", schema: THEME_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Analyze this response about "${companyName}":\n\n"""\n${responseText}\n"""`,
        },
      ],
    });

    // Structured outputs return as a single text block containing the JSON.
    const textBlock = response.content.find((b: any) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (!textBlock) {
      console.warn(
        `[theme-analysis] no text block. stop_reason=${response.stop_reason}`,
      );
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (e) {
      console.error("[theme-analysis] JSON parse failed despite structured output:", e, textBlock.text.slice(0, 200));
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn("[theme-analysis] structured output returned non-array:", textBlock.text.slice(0, 200));
      return [];
    }

    if (parsed.length === 0) {
      console.warn(`[theme-analysis] EMPTY for "${companyName}". Input head: ${responseText.slice(0, 150)}`);
    } else {
      console.log(`[theme-analysis] ${parsed.length} themes for "${companyName}". cache_read=${response.usage?.cache_read_input_tokens ?? 0} cache_write=${response.usage?.cache_creation_input_tokens ?? 0}`);
    }

    return parsed.map(validateAndCleanTheme);
  } catch (e: any) {
    // Surface rate-limit / overload distinctly so the bulk function's per-response
    // try/catch can decide what to do. The SDK throws typed exceptions; check by
    // status rather than message-string matching.
    if (e instanceof Anthropic.RateLimitError) {
      throw new Error(`Claude rate-limited (429): ${e.message}`);
    }
    if (e instanceof Anthropic.APIError) {
      throw new Error(`Claude API error ${e.status}: ${e.message}`);
    }
    throw e;
  }
}
