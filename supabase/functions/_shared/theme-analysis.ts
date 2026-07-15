// Shared theme extraction used by three paths that must never drift:
//   - ai-thematic-analysis        (real-time, one response, fire-and-forget)
//   - ai-thematic-analysis-bulk   (admin backfill panel + safety-net cron)
//   - theme-backfill-tick         (cron: picks missing responses, fans out
//                                  to ai-thematic-analysis-bulk)
// The prompt, schema, model, and validation live here.
//
// Backed by Gemini 2.5 Flash-Lite via responseSchema (schema-enforced JSON).
// Why Flash-Lite, not Claude Haiku (the previous backend):
//   - Cost. Haiku 4.5 is $1/$5 per 1M input/output tokens; Flash-Lite is
//     $0.10/$0.40 — ~11x cheaper on output, which dominates this workload.
//     That also beats the old cron path's batched-Haiku rate ($0.50/$2.50)
//     by ~6x, which is why the cron went back to synchronous calls and the
//     Anthropic Batches plumbing was retired.
//   - Reliability is preserved. Gemini's responseSchema enforces the JSON
//     shape server-side INCLUDING the attribute_id enum (the 13 v2 ids), so
//     no markdown-fence/regex cleanup. Validated 2026-07-15 against a
//     40-response production sample: 0 empty regressions, 0 enum leakage,
//     ~0.85 sentiment agreement vs the Haiku baseline.
//   - The 2025-era Gemini pain was the FREE-tier 10K-requests/day cap, not
//     the model; paid billing has no daily ceiling.
//   - Thinking is disabled (thinkingBudget: 0): straight classification.
// Output tokens still dominate spend, so the prompt caps theme count and
// field lengths (2-6 themes, short names/descriptions/snippets).
//
// The volume lever is upstream: analyze-response only triggers extraction
// when company_mentioned = true, and find_responses_missing_themes applies
// the same filter plus themes_none_found_at IS NULL, so not-mentioned and
// confirmed-empty responses never reach this function.
//
// Requires the GEMINI_API_KEY project secret.

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// @ts-ignore Deno global is available in the edge runtime.
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

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

// Methodology v2 taxonomy (mirror of src/config/attributes.ts — Deno edge
// functions can't import the Vite app module). id → display name.
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

// Fold any retired v1 id the model may still emit (LLMs regress to their prior
// despite the prompt) into its v2 successor, so stray ids can't reach ai_themes
// and split one attribute across two ids. null = retired with no successor.
const LEGACY_ATTRIBUTE_MAP: Record<string, string | null> = {
  "mission-purpose": "mission-purpose-impact",
  "social-impact": "mission-purpose-impact",
  "rewards-recognition": "compensation",
  "security-perks": "job-security",
  "application-process": "application-communication",
  "candidate-communication": "application-communication",
  "overall-candidate-experience": null,
};

// Gemini responseSchema (an OpenAPI subset). Differences from Anthropic's
// JSON-schema mode: types are UPPERCASE, no `additionalProperties`, and
// `propertyOrdering` fixes field order. The `enum` on attribute_id still
// constrains emissions to the 13 v2 ids server-side — the property we most
// need enforced.
const THEME_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      theme_name: { type: "STRING" },
      theme_description: { type: "STRING" },
      sentiment: { type: "STRING", enum: ["positive", "negative", "neutral"] },
      sentiment_score: { type: "NUMBER" },
      attribute_id: { type: "STRING", enum: V2_ATTRIBUTE_IDS },
      attribute_name: { type: "STRING" },
      confidence_score: { type: "NUMBER" },
      keywords: { type: "ARRAY", items: { type: "STRING" } },
      context_snippets: { type: "ARRAY", items: { type: "STRING" } },
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
    propertyOrdering: [
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

// Resolve any emitted id to a live v2 id: pass v2 ids through, fold legacy v1
// ids to their successor, and reject everything else (incl. retired ids that
// map to null) as "unknown" so it never counts under a real attribute.
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
    // Keep the display name consistent with the (normalized) id when known.
    attribute_name: V2_ATTRIBUTES[attributeId] || t?.attribute_name || "Unknown Attribute",
    confidence_score: Math.max(0, Math.min(1, parseFloat(t?.confidence_score) || 0)),
    keywords: Array.isArray(t?.keywords) ? t.keywords : [],
    context_snippets: Array.isArray(t?.context_snippets) ? t.context_snippets : [],
  };
}

export async function analyzeThemes(
  responseText: string,
  companyName: string,
): Promise<AITheme[]> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const requestBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Analyze this response about "${companyName}":\n\n"""\n${responseText}\n"""`,
          },
        ],
      },
    ],
    generationConfig: {
      // Schema-enforced JSON — Gemini validates the shape server-side, so the
      // returned text is guaranteed-parseable and the attribute_id enum holds.
      responseMimeType: "application/json",
      responseSchema: THEME_SCHEMA,
      // Deterministic classification.
      temperature: 0,
      // Headroom so the JSON array is never truncated mid-write (MAX_TOKENS
      // yields unparseable partial JSON). Output is cheap on Flash-Lite.
      maxOutputTokens: 8192,
      // Straight classification — no reasoning tokens needed.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  // Transient Gemini failures (429 quota, 5xx overload — 503 "model
  // overloaded" showed up during validation) are retried with backoff so a
  // blip doesn't drop themes and lean on the backfill cron.
  const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;

  let resp: Response | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    resp = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    if (resp.ok) break;

    const errText = await resp.text().catch(() => "");
    if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_ATTEMPTS) {
      // 500ms, then 1500ms.
      await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt - 1)));
      continue;
    }
    // Non-retryable, or out of attempts. Surface 429 distinctly so the bulk
    // function's per-response try/catch can treat quota exhaustion specially.
    if (resp.status === 429) {
      throw new Error(`Gemini rate-limited (429) after ${attempt} attempts: ${errText.slice(0, 300)}`);
    }
    throw new Error(`Gemini API error ${resp.status} after ${attempt} attempts: ${errText.slice(0, 300)}`);
  }

  const data = await (resp as Response).json();

  // A blocked prompt (safety filter) or an empty candidate → treat as "no
  // themes" rather than an error, mirroring the old behaviour on empty output.
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text: string = (candidate?.content?.parts ?? [])
    .map((p: any) => p?.text ?? "")
    .join("");

  if (!text) {
    console.warn(
      `[theme-analysis] no text. finishReason=${finishReason} blockReason=${data?.promptFeedback?.blockReason ?? "none"}`,
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("[theme-analysis] JSON parse failed despite responseSchema:", e, text.slice(0, 200));
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn("[theme-analysis] responseSchema returned non-array:", text.slice(0, 200));
    return [];
  }

  if (parsed.length === 0) {
    console.warn(`[theme-analysis] EMPTY for "${companyName}". Input head: ${responseText.slice(0, 150)}`);
  } else {
    const usage = data?.usageMetadata;
    console.log(
      `[theme-analysis] ${parsed.length} themes for "${companyName}". tokens in=${usage?.promptTokenCount ?? 0} out=${usage?.candidatesTokenCount ?? 0}`,
    );
  }

  return parsed.map(validateAndCleanTheme);
}
