// ─── px-tools: shared helpers ───────────────────────────────────────────────
// Utilities shared by every data tool. Extracted from chat-with-data so the
// MCP server and the in-app chat run the SAME tool layer — one source of
// truth for numbers, coverage signals, and tenant checks.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// Bounded integer parser for tool inputs like `limit`. Clamps to [min, max],
// returns fallback if non-numeric/NaN. Defends against the model passing
// floats, negatives, or strings.
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// Short per-request correlation ID for log tracing. Not secret, only for
// joining log lines belonging to the same request across the tool loop.
export function genRequestId(): string {
  try { return (crypto as any).randomUUID().slice(0, 8); }
  catch { return Math.random().toString(36).slice(2, 10); }
}

// ─── Coverage metadata ──────────────────────────────────────────────────────
// Every tool return embeds a `_coverage` field so the consuming model can
// write honest refusals when data is missing instead of guessing. This
// matters twice as much over MCP: the host model (ChatGPT/Claude) never sees
// our system prompt, so the tool RESULT is the only place caveats can live.
// Tenant isolation is non-negotiable: `_coverage` never names other
// organizations.
export function coverageFound(meta: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'found', ...meta };
}
export function coverageNoData(reason: string, meta: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'no_data', reason, ...meta };
}
export function coveragePartial(note: string, meta: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: 'partial', note, ...meta };
}

// ─── Methodology constants ──────────────────────────────────────────────────
// Methodology v2 (July 2026): these models are excluded from every
// client-facing calculation, by filter — their rows stay in the DB as the
// audit trail for previously published numbers.
export const EXCLUDED_AI_MODELS = ['claude', 'gemini', 'deepseek'];
export const EXCLUDED_AI_MODELS_FILTER = '(claude,gemini,deepseek)';

// One-line methodology notes embedded in result envelopes. Self-caveating
// payloads are the contract: any host model must be able to quote these
// without access to our prompts.
export const METHODOLOGY_NOTES = {
  sentiment:
    'Sentiment = positive / (positive + negative) theme labels; neutral themes excluded. Null/absent = no polarized signal yet.',
  visibility:
    'Visibility = % of AI responses that mention the company by name.',
  model_exclusions:
    `Models ${EXCLUDED_AI_MODELS.join(', ')} are excluded from all published metrics (methodology v2).`,
  eps:
    'EPS = 50% sentiment + 30% visibility + 20% relevance.',
} as const;

// Standard result envelope metadata. `data_as_of` = when the underlying
// rollup was last calculated (NOT "now"); a stale confident answer is the
// worst failure mode, so freshness always travels with the numbers.
export interface EnvelopeMeta {
  data_as_of: string | null;
  date_range?: { from: string; to: string } | null;
  scope_companies?: number;
  scope_brand?: string;
  locations_matched?: string[];
  methodology?: string[];
  [k: string]: unknown;
}

export function buildMeta(partial: Partial<EnvelopeMeta>): EnvelopeMeta {
  return {
    data_as_of: null,
    methodology: [METHODOLOGY_NOTES.model_exclusions],
    ...partial,
  };
}

// Months helper: last N calendar months as ISO first-of-month dates
// (matching the `response_month` grain of every stats cube), oldest first.
export function lastMonths(monthsBack: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

// Sentiment ratio (methodology v2): positive/(positive+negative), 2dp, null
// when nothing polarized.
export function sentimentRatio(pos: number, neg: number): number | null {
  const polarized = pos + neg;
  if (polarized <= 0) return null;
  return Math.round((pos / polarized) * 100) / 100;
}

export function extractSnippet(text: string, keyword: string, maxLength: number): string {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(keyword.toLowerCase());
  if (idx === -1) return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + maxLength - 100);
  return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}
