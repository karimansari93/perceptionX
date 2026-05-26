// Shared theme extraction used by both ai-thematic-analysis (real-time, one
// response at a time, called fire-and-forget from analyze-response) and
// ai-thematic-analysis-bulk (cron + admin backfill panel). Kept in one place
// so the prompt, attribute taxonomy, and validation behaviour can't drift
// between the two paths — a response themed by the real-time trigger should
// be indistinguishable from one themed by the backfill cron.
//
// Backed by Gemini 2.5 Flash with `responseMimeType: "application/json"` so
// the model is forced to emit a JSON array directly. That removed the
// markdown-fence cleanup + regex rescue logic the OpenAI version needed —
// every response is JSON.parse-safe. Faster (~1-3s vs 3-8s for gpt-4o-mini)
// and ~50% cheaper, so we can fit larger chunks under the 150s edge timeout.

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

// Response-level JSON schema enforced by Gemini. Keeping it loose on the
// required[] set (only the structural fields are required) so a model that
// produces a partial row isn't a hard failure — validateAndCleanTheme below
// fills sensible defaults for everything else.
const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      theme_name: { type: "STRING" },
      theme_description: { type: "STRING" },
      sentiment: { type: "STRING", enum: ["positive", "negative", "neutral"] },
      sentiment_score: { type: "NUMBER" },
      talentx_attribute_id: { type: "STRING" },
      talentx_attribute_name: { type: "STRING" },
      confidence_score: { type: "NUMBER" },
      keywords: { type: "ARRAY", items: { type: "STRING" } },
      context_snippets: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: [
      "theme_name",
      "sentiment",
      "sentiment_score",
      "talentx_attribute_id",
      "talentx_attribute_name",
    ],
  },
};

function buildPrompt(responseText: string, companyName: string): string {
  return `You are an expert in analyzing company responses to extract meaningful themes about employer branding and talent perception.

Analyze the following response about "${companyName}" and identify specific themes that relate to talent attraction and employer branding.

CRITICAL: Only extract themes about "${companyName}" itself. Do NOT extract themes about competitors or other companies mentioned in the response. Focus exclusively on themes, perceptions, and information about "${companyName}".

For each theme you identify:

1. Provide a clear, concise theme name
2. Write a brief description of the theme
3. Determine if the sentiment is positive, negative, or neutral
4. Assign a sentiment score from -1 (very negative) to 1 (very positive)
5. Map the theme to the most relevant TalentX attribute from this list. BE VERY SPECIFIC about Company Culture:
   - mission-purpose: Mission & Purpose (company mission, values, purpose, making a difference)
   - rewards-recognition: Rewards & Recognition (compensation, benefits, bonuses, recognition programs)
   - company-culture: Company Culture (ONLY workplace atmosphere, team dynamics, cultural practices, work environment - NOT general values, mission, or benefits)
   - social-impact: Social Impact (community involvement, charity, environmental responsibility, giving back)
   - inclusion: Inclusion (diversity, equity, accessibility, minority representation, LGBTQ+ support)
   - innovation: Innovation (cutting-edge technology, research, breakthrough products, R&D culture)
   - wellbeing-balance: Wellbeing & Balance (work-life balance, flexible work, mental health, wellness programs)
   - leadership: Leadership (management quality, executive decisions, leadership style, management practices)
   - security-perks: Security & Perks (job security, office amenities, food, gym, transportation benefits)
   - career-opportunities: Career Opportunities (growth, advancement, learning, training, mentorship, promotions)
   - application-process: Application Process (ease, clarity, and speed of applying or moving through the hiring funnel)
   - candidate-communication: Candidate Communication (responsiveness, clarity, and helpfulness of recruiter/company updates)
   - interview-experience: Interview Experience (structure, fairness, difficulty, panel behavior, logistics)
   - candidate-feedback: Candidate Feedback (quality and timeliness of interview or application feedback)
   - onboarding-experience: Onboarding Experience (new hire orientation, training, first-week experience)
   - overall-candidate-experience: Overall Candidate Experience (holistic perception of the end-to-end candidate journey)

IMPORTANT CLASSIFICATION RULES:
- Company Culture should ONLY be used for themes about workplace atmosphere, team dynamics, cultural practices, and work environment
- If a theme could fit multiple categories, choose the MORE SPECIFIC one (e.g., choose "Mission & Purpose" over "Company Culture" for values)
- Values and mission belong to "Mission & Purpose", not "Company Culture"
- Benefits and compensation belong to "Rewards & Recognition", not "Company Culture"
- Work-life balance belongs to "Wellbeing & Balance", not "Company Culture"
- Candidate journey topics (application steps, recruiter updates, interview logistics, feedback, onboarding, overall candidate perception) must use the dedicated candidate experience attributes above rather than employee experience categories

6. Provide a confidence score from 0 to 1
7. Extract relevant keywords
8. Provide 1-2 context snippets from the response that support this theme

Focus on themes that would be relevant to potential employees evaluating "${companyName}" as a workplace. Look for both positive and negative themes. Always return at least one theme if the response contains ANY information, positive, negative, or neutral, about "${companyName}" — even if the response also discusses competitors or comparisons. Only return an empty array if the response truly contains no information whatsoever about "${companyName}".

Response to analyze:
"""
${responseText}
"""`;
}

/** Coerce one model-emitted theme row to our schema with safe defaults. */
function validateAndCleanTheme(theme: any): AITheme {
  return {
    theme_name: theme?.theme_name || "Unnamed Theme",
    theme_description: theme?.theme_description || "",
    sentiment: ["positive", "negative", "neutral"].includes(theme?.sentiment)
      ? theme.sentiment
      : "neutral",
    sentiment_score: Math.max(-1, Math.min(1, parseFloat(theme?.sentiment_score) || 0)),
    talentx_attribute_id: theme?.talentx_attribute_id || "unknown",
    talentx_attribute_name: theme?.talentx_attribute_name || "Unknown Attribute",
    confidence_score: Math.max(0, Math.min(1, parseFloat(theme?.confidence_score) || 0)),
    keywords: Array.isArray(theme?.keywords) ? theme.keywords : [],
    context_snippets: Array.isArray(theme?.context_snippets) ? theme.context_snippets : [],
  };
}

/**
 * Run Gemini 2.5 Flash with JSON-mode output for a single response.
 * Throws on API errors / quota / safety blocks; caller decides retry policy.
 */
export async function analyzeThemes(
  responseText: string,
  companyName: string,
): Promise<AITheme[]> {
  // @ts-ignore Deno global is available in the edge runtime.
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const requestBody = {
    contents: [
      {
        parts: [{ text: buildPrompt(responseText, companyName) }],
      },
    ],
    generationConfig: {
      // Native JSON mode — Gemini guarantees parseable output, so we don't
      // need the markdown-fence / regex rescue dance the OpenAI version had.
      responseMimeType: "application/json",
      // Low temp = consistent extraction. Theme classification is not a
      // creative task; we'd rather two runs of the same text agree.
      temperature: 0.2,
      // Gemini 2.5 Flash bills internal "thinking" against the same
      // maxOutputTokens budget that the JSON output uses. Observed live:
      // a 764-token prompt produced 2392 thinking tokens + 1246 output
      // tokens — a more complex response easily eats 4096, leaving no
      // room for the JSON and finishing with empty content. We don't
      // need chain-of-thought for structured extraction, so disable it.
      thinkingConfig: { thinkingBudget: 0 },
      // Headroom even at thinkingBudget=0 — extraction output can run
      // ~3-5k tokens for very rich responses with many themes.
      maxOutputTokens: 8192,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    // Surface rate-limit / quota distinctly so callers can back off properly.
    if (response.status === 429 || /quota|overloaded/i.test(errBody)) {
      throw new Error(`Gemini rate-limited (${response.status}): ${errBody}`);
    }
    throw new Error(`Gemini API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();

  // Safety block / no candidates — surface as zero-themes rather than error,
  // so the response is marked "analysed, nothing relevant" instead of being
  // retried by the cron forever.
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    console.warn("[theme-analysis] Gemini returned no candidates", data);
    return [];
  }
  if (candidate.finishReason === "SAFETY" || candidate.finishReason === "RECITATION") {
    console.warn("[theme-analysis] Gemini blocked response:", candidate.finishReason);
    return [];
  }

  const content = candidate?.content?.parts?.[0]?.text;
  if (!content) {
    console.warn("[theme-analysis] Gemini returned no content parts. finishReason=" + candidate.finishReason, JSON.stringify(candidate).slice(0, 500));
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // Should never happen with responseMimeType=application/json + schema,
    // but if Gemini emits garbage (e.g. truncated at maxOutputTokens) we'd
    // rather skip the response than throw and have the cron retry forever.
    console.error("[theme-analysis] JSON parse failed despite JSON mode:", e, content);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn("[theme-analysis] Gemini returned non-array:", parsed);
    return [];
  }

  // Diagnostic: log empty arrays so we can see whether Gemini is being too
  // strict with the "discusses competitors mostly, return empty" guidance.
  if (parsed.length === 0) {
    console.warn(
      `[theme-analysis] Gemini returned empty array for "${companyName}" (finishReason=${candidate.finishReason}). First 200 chars of input: ${responseText.slice(0, 200)}`,
    );
  }

  return parsed.map(validateAndCleanTheme);
}
