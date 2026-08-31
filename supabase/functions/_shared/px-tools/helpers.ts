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
// Methodology v2 (July 2026): published metrics are calculated from the
// consumer AI platforms in TRACKED_PLATFORMS; other models' rows stay in the
// DB as an internal audit trail and are filtered out of every read below.
// Presentation rule (client feedback, Aug 2026): payloads say what's
// INCLUDED, never what's excluded.
export const EXCLUDED_AI_MODELS = ['claude', 'gemini', 'deepseek'];
export const EXCLUDED_AI_MODELS_FILTER = '(claude,gemini,deepseek)';
export const TRACKED_PLATFORMS = 'ChatGPT, Perplexity, Google AI Overviews, and Google AI Mode';

// One-line methodology notes embedded in result envelopes. Self-caveating
// payloads are the contract: any host model must be able to quote these
// without access to our prompts.
export const METHODOLOGY_NOTES = {
  sentiment:
    'Sentiment = the share of opinionated (positive or negative) themes that are positive, as a percentage. Absent = not enough opinionated signal yet.',
  visibility:
    'Visibility = % of AI answers that mention the company by name.',
  platform_coverage:
    `Metrics are calculated from tracked consumer AI platforms: ${TRACKED_PLATFORMS}.`,
  eps:
    'EPS = 50% sentiment + 30% visibility + 20% relevance.',
} as const;

// Standard result envelope metadata. Client-facing periods are QUARTERS —
// never raw dates or timestamps (collection is continuous inside a quarter,
// so hard dates read as gaps/staleness that aren't real). `latest_period`
// flags the running quarter as in progress so a light last data point is
// never misread as a decline.
export interface EnvelopeMeta {
  latest_period?: string | null;
  period_range?: { from: string; to: string } | null;
  scope_companies?: number;
  scope_brand?: string;
  locations_matched?: string[];
  methodology?: string[];
  [k: string]: unknown;
}

export function buildMeta(partial: Partial<EnvelopeMeta>): EnvelopeMeta {
  return {
    methodology: [METHODOLOGY_NOTES.platform_coverage],
    ...partial,
  };
}

// ─── Quarter helpers ────────────────────────────────────────────────────────
// Internal storage stays monthly (the stats cubes' response_month grain);
// everything client-facing rolls up to quarters at read time — same policy
// as the dashboard's quarterly cutover.

export function monthToQuarter(isoMonth: string): string {
  const [y, m] = isoMonth.slice(0, 10).split('-').map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

export function currentQuarter(): string {
  const now = new Date();
  return `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;
}

export function quarterLabel(q: string): string {
  return q === currentQuarter() ? `${q} (in progress)` : q;
}

// The ISO first-of-month dates covering the last N quarters (including the
// running one), oldest first — used to filter the monthly cubes.
export function lastQuarterMonths(quartersBack: number): string[] {
  const now = new Date();
  const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3; // 0,3,6,9
  const start = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth - (quartersBack - 1) * 3, 1));
  const out: string[] = [];
  const cursor = new Date(start);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

// Ascending-sort key for "Q3 2026" labels.
export function quarterSortKey(q: string): string {
  const m = q.match(/^Q(\d) (\d{4})/);
  return m ? `${m[2]}-${m[1]}` : q;
}

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

// Sentiment (methodology v2) as an integer percentage: share of opinionated
// themes that are positive. Null when nothing opinionated. Percentages, not
// decimals — "81%", never "0.81".
export function sentimentPct(pos: number, neg: number): number | null {
  const polarized = pos + neg;
  if (polarized <= 0) return null;
  return Math.round((pos / polarized) * 100);
}

export function extractSnippet(text: string, keyword: string, maxLength: number): string {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(keyword.toLowerCase());
  if (idx === -1) return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + maxLength - 100);
  return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}
