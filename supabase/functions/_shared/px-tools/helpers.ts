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
  periods:
    'Data is collected in periodic measurement waves (typically one per quarter) and reported by quarter. The periods listed are every period measured for this scope: a calendar month or quarter that is not listed was not a measurement period, not missing data. Sample sizes differ by wave, so compare periods on percentages, never on counts.',
  shares:
    'Percentages are the headline numbers; anything under sample_size is context for how much data sits behind a percentage and is never the story.',
  sentiment:
    'Sentiment = the share of opinionated (positive or negative) themes that are positive, as a percentage. Absent = not enough opinionated signal yet.',
  visibility:
    'Visibility = % of AI answers that mention the company by name.',
  relevance:
    'Relevance = citation-weighted freshness of the sources AI platforms cite (0-100).',
  platform_coverage:
    `Metrics are calculated from tracked consumer AI platforms: ${TRACKED_PLATFORMS}.`,
  eps:
    'EPS = 50% sentiment + 30% visibility + 20% relevance.',
  attribute_share:
    'mentioned_in_pct_of_answers = % of AI answers in the period that discuss the attribute; share_of_themes_pct = the attribute\'s share of all themes (the dashboard\'s attribute mix).',
  theme_sample:
    'Theme-level figures (individual themes, per-platform sentiment) are computed from a random sample of the period\'s answers; sample_size states how many. Visibility, attribute and source figures are complete.',
  pages:
    'top_pages = the most-cited page URLs (with titles) on each source; a page\'s cited_in_pct_of_answers is the % of all answers in the window, the same denominator as its domain. Link a source with the exact url returned; never construct or guess a URL. Under a job_function filter the pages come from a random sample of the filtered answers and sample_size.answers_sampled_for_pages states how many.',
  filters:
    'Figures span every market and job function in the scope unless _meta lists locations_matched or job_functions_matched. location and job_function are optional filters on the market-aware tools; by_job_function splits a figure by function. Never present unfiltered figures as specific to a role, function or market.',
} as const;

// Standard result envelope metadata. Client-facing periods are QUARTERS
// (never raw dates or timestamps), and they are MEASURED quarters: the
// `periods` list is the complete set of collection waves in the window, so a
// host model never has to guess whether an unlisted calendar quarter is a
// gap. `latest_period` carries "(in progress)" only while a collection wave
// is genuinely still writing.
export interface EnvelopeMeta {
  latest_period?: string | null;
  period_range?: { from: string; to: string } | null;
  periods?: string[];
  collection_in_progress?: boolean;
  scope_companies?: number;
  scope_brand?: string;
  locations_matched?: string[];
  methodology?: string[];
  [k: string]: unknown;
}

export function buildMeta(partial: Partial<EnvelopeMeta>): EnvelopeMeta {
  return {
    methodology: [METHODOLOGY_NOTES.platform_coverage, METHODOLOGY_NOTES.periods],
    ...partial,
  };
}

// ─── Quarter helpers ────────────────────────────────────────────────────────
// Internal storage stays monthly (the stats cubes' response_month grain);
// everything client-facing rolls up to quarters at read time — same policy
// as the dashboard's quarterly cutover (src/utils/quarterKey.ts).

export function monthToQuarter(isoMonth: string): string {
  const [y, m] = isoMonth.slice(0, 10).split('-').map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

// Ascending-sort key for "Q3 2026" labels.
export function quarterSortKey(q: string): string {
  const m = q.match(/^Q(\d) (\d{4})/);
  return m ? `${m[2]}-${m[1]}` : q;
}

export function sortQuarters(quarters: Iterable<string>): string[] {
  return Array.from(new Set(quarters)).sort((a, b) => quarterSortKey(a).localeCompare(quarterSortKey(b)));
}

// Distinct quarters (ascending) covered by a list of ISO first-of-month dates.
export function quartersOfMonths(months: string[]): string[] {
  return sortQuarters(months.map(monthToQuarter));
}

// Presentation label: "(in progress)" is attached ONLY to the quarter whose
// collection wave is still writing (decided from data, never from the
// calendar) so a completed wave is never hedged as "may still be filling in".
export function labelQuarter(q: string, inProgressQuarter: string | null): string {
  return inProgressQuarter && q === inProgressQuarter ? `${q} (in progress)` : q;
}

// Strip a presentation label back to its bare quarter.
export function bareQuarter(label: string): string {
  return label.replace(/ \(in progress\)$/, '');
}

// The window a tool reports on: the last `quartersBack` MEASURED quarters of
// the scope (not calendar quarters — a client that skipped a quarter still
// gets N periods), as the months to filter cubes with plus the quarter labels
// ascending.
export function selectRecentQuarters(
  measuredMonths: string[],
  quartersBack: number
): { months: string[]; quarters: string[] } {
  const months = Array.from(new Set(measuredMonths.map(m => m.slice(0, 10)))).sort();
  const quarters = quartersOfMonths(months);
  const keep = new Set(quarters.slice(Math.max(0, quarters.length - Math.max(1, quartersBack))));
  return {
    months: months.filter(m => keep.has(monthToQuarter(m))),
    quarters: quarters.filter(q => keep.has(q)),
  };
}

// Roll monthly cube rows into an ordered quarterly series. `pick` extracts
// the numeric fields to sum from each row. Quarter labels come out already
// presentation-ready (see labelQuarter).
export function toQuarterly<T extends Record<string, number>>(
  rows: any[],
  pick: (row: any) => T,
  inProgressQuarter: string | null = null
): Array<{ quarter: string } & T> {
  const byQuarter = new Map<string, T>();
  for (const row of rows) {
    const q = monthToQuarter(String(row.response_month));
    const vals = pick(row);
    if (!byQuarter.has(q)) {
      byQuarter.set(q, { ...vals });
    } else {
      const agg = byQuarter.get(q)!;
      for (const k of Object.keys(vals)) (agg as any)[k] += vals[k];
    }
  }
  return Array.from(byQuarter.entries())
    .sort(([a], [b]) => quarterSortKey(a).localeCompare(quarterSortKey(b)))
    .map(([quarter, vals]) => ({ quarter: labelQuarter(quarter, inProgressQuarter), ...vals }));
}

// ─── Number presentation ────────────────────────────────────────────────────
// Percentages are integers ("81", never "0.81"); null when there is no
// denominator so the host model says "no signal" instead of reading 0.

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

// Sentiment (methodology v2) as an integer percentage: share of opinionated
// themes that are positive. Null when nothing opinionated.
export function sentimentPct(pos: number, neg: number): number | null {
  const polarized = pos + neg;
  if (polarized <= 0) return null;
  return Math.round((pos / polarized) * 100);
}

// One-decimal rate (e.g. citations per answer). Null without a denominator.
export function rate1(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10) / 10;
}

// Percentage-point change between two integer percentages.
export function pointsDelta(latest: number | null | undefined, previous: number | null | undefined): number | null {
  if (latest === null || latest === undefined || previous === null || previous === undefined) return null;
  return latest - previous;
}

// Period-over-period change block shared by every trend-shaped payload:
// latest vs the PREVIOUS MEASURED period (the dashboard's delta chip rule),
// plus first→latest when there are more than two periods. Values are
// percentage points; `note` only appears while a wave is still writing.
export function changeBlock(
  series: Array<{ quarter: string; value: number | null }>,
  inProgressQuarter: string | null
): Record<string, unknown> | null {
  const points = series.filter(s => s.value !== null && s.value !== undefined) as Array<{ quarter: string; value: number }>;
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const first = points[0];
  const block: Record<string, unknown> = {
    latest_period: latest.quarter,
    latest: latest.value,
    previous_period: previous.quarter,
    previous: previous.value,
    delta_points_vs_previous: latest.value - previous.value,
  };
  if (points.length > 2) {
    block.first_period = first.quarter;
    block.first = first.value;
    block.delta_points_since_first = latest.value - first.value;
  }
  if (inProgressQuarter && bareQuarter(latest.quarter) === inProgressQuarter) {
    block.note = `${latest.quarter} is still being collected; its numbers can move until the wave completes.`;
  }
  return block;
}

export function extractSnippet(text: string, keyword: string, maxLength: number): string {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(keyword.toLowerCase());
  if (idx === -1) return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + maxLength - 100);
  return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}

// ─── Page-level links ───────────────────────────────────────────────────────
// The most-cited page URLs for a domain (mcp_get_cited_pages rows, or the
// top_pages nested in mcp_get_attribute_sources rows), shares-first, so a
// host model can link a source instead of naming a bare domain.
// `denominator` is the answer count the share is of (the window's answers
// for cube-backed reads, the sampled answers for the attribute read);
// `shareKey` names what the percentage is of. Rows without an http(s) url
// are dropped — a link the host can't open is worse than none.
export const PAGES_UNAVAILABLE_NOTE =
  'Page-level links could not be computed for this scope right now; the domain figures are unaffected.';

export function pageEntry(row: any, denominator: number, shareKey: string): Record<string, unknown> | null {
  const url = String(row?.url || '');
  if (!/^https?:\/\//i.test(url)) return null;
  const answersCiting = Number(row?.answers_citing) || 0;
  return {
    url,
    title: row?.title ? String(row.title) : null,
    [shareKey]: pct(answersCiting, denominator),
    sample_size: { answers_citing: answersCiting },
  };
}

export function topPagesByDomain(rows: any[], denominator: number, shareKey: string): Map<string, Record<string, unknown>[]> {
  const byDomain = new Map<string, Record<string, unknown>[]>();
  for (const row of rows || []) {
    const domain = String(row?.domain || '');
    const entry = pageEntry(row, denominator, shareKey);
    if (!domain || !entry) continue;
    const list = byDomain.get(domain) || [];
    list.push(entry);
    byDomain.set(domain, list);
  }
  return byDomain;
}
