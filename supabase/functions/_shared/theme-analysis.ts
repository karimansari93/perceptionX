// Shared theme extraction used by both ai-thematic-analysis (real-time, one
// response at a time, called fire-and-forget from analyze-response) and
// ai-thematic-analysis-bulk (cron + admin backfill panel). Kept in one place
// so the prompt, attribute taxonomy, and validation behaviour can't drift
// between the two paths.
//
// Backed by Gemini 2.5 Flash-Lite via responseSchema (schema-enforced JSON).
// Why Flash-Lite, not Haiku:
//   - Cost. Haiku 4.5 is $1/$5 per 1M input/output tokens; Flash-Lite is
//     $0.10/$0.40 — roughly 11x cheaper on output, which dominates this
//     workload. Theme extraction was the biggest line on the LLM bill.
//   - Reliability is preserved. Gemini's `responseSchema` enforces the JSON
//     shape server-side, INCLUDING the attribute_id enum (the 13 v2 ids), so
//     we still avoid the markdown-fence / regex-rescue cleanup that bit us on
//     the earlier Gemini path. `normalizeAttributeId` remains the belt-and-
//     suspenders fallback for anything that still slips through.
//   - The earlier Gemini pain was the FREE-tier 10K-requests/day cap (burned
//     through on a 9k backlog), not the model. Paid billing has no daily
//     ceiling, so that failure mode is gone.
//   - Thinking is disabled (thinkingBudget: 0) so we don't pay for or wait on
//     reasoning tokens on what is a straightforward classification task.
//
// The real volume lever is still upstream: callers only invoke theme
// extraction when company_mentioned = true, so responses that don't mention
// the company never reach this function.
//
// Requires the GEMINI_API_KEY secret (set it in Supabase project secrets and
// redeploy ai-thematic-analysis + ai-thematic-analysis-bulk).

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

// Gemini responseSchema (a subset of OpenAPI). Note the differences from
// Anthropic's JSON-schema mode: types are UPPERCASE, there is no
// `additionalProperties`, and `propertyOrdering` fixes field order for
// consistent output. The `enum` on attribute_id still constrains emissions to
// the 13 v2 ids server-side — the property we most needed to keep enforced.
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

const SYSTEM_PROMPT = `You are an expert in analyzing AI-generated responses to extract themes about a company's employer brand and talent perception.

For each theme you identify, output an object with:
- theme_name: clear, concise name
- theme_description: brief description of the theme
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
- keywords: array of relevant keywords drawn from the response
- context_snippets: array of 1-2 verbatim snippets from the response that support the theme

Classification rules — be strict:
- company-culture is ONLY for workplace atmosphere, team dynamics, cultural practices, work environment, and feeling valued/recognized
- Mission, values, purpose, and social/community impact belong to mission-purpose-impact, NOT company-culture
- Pay, benefits, and perks belong to compensation, NOT company-culture; job stability/layoffs belong to job-security, NOT compensation
- Work-life balance, mental health, flexibility, and remote work belong to wellbeing-balance, NOT company-culture
- Candidate-journey topics belong to the dedicated candidate-experience attributes: the application process and recruiter communication → application-communication; interviews → interview-experience; post-interview/application feedback → candidate-feedback; onboarding → onboarding-experience

Coverage:
- Look for both positive and negative themes
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

function validateAndCleanTheme(t: any): AITheme {
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
      // Comfortable headroom so the JSON array is never truncated (MAX_TOKENS
      // would yield unparseable partial JSON). Output is cheap on Flash-Lite.
      maxOutputTokens: 8192,
      // Straightforward classification — no reasoning tokens needed. Disabling
      // thinking keeps cost and latency down.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    // Surface rate-limit / quota distinctly so the bulk function's per-response
    // try/catch can decide what to do (429 = per-minute quota, retryable).
    if (resp.status === 429) {
      throw new Error(`Gemini rate-limited (429): ${errText.slice(0, 300)}`);
    }
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();

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
