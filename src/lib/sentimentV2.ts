// Methodology v2 (July 2026) — the ONE sentiment definition.
//
// Headline sentiment = positive / (positive + negative), computed from the
// text labels in ai_themes.sentiment. Neutral themes are excluded from the
// score (they still appear in theme-composition views). When a scope has no
// polarized themes the score is null ("no signal"), never 0 — on this scale
// 0 means "every polarized theme was negative".
//
// The numeric ai_themes.sentiment_score is NEVER used in a published metric
// (dashboard, reports, Index); it is internal-prioritization only.
//
// The same definition lives in the rollup SQL
// (supabase/migrations/20260719120000_methodology_v2_sentiment_formula.sql),
// the report generators, and the edge functions. Change them together or not
// at all.

// Models excluded from every client-facing calculation, by filter — their
// rows stay in the DB as the audit trail for previously published numbers.
export const EXCLUDED_AI_MODELS = ['claude', 'gemini', 'deepseek'];

// PostgREST value for `.not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)`.
export const EXCLUDED_AI_MODELS_FILTER = `(${EXCLUDED_AI_MODELS.join(',')})`;

export const isExcludedAiModel = (model: string | null | undefined): boolean =>
  !!model && EXCLUDED_AI_MODELS.includes(model.toLowerCase());

/** positive / (positive + negative); null when there are no polarized themes. */
export const sentimentRatioV2 = (positive: number, negative: number): number | null => {
  const polarized = positive + negative;
  return polarized > 0 ? positive / polarized : null;
};
