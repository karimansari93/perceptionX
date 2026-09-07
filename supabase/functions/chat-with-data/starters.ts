// ─── chat-with-data: data-grounded starter questions ────────────────────────
// The welcome screen's four suggestions, built from the organization's own
// px-tools data (the same tools the analyst answers with) so a suggestion is
// never something the guardrails forbid or the data can't answer:
//   1. a visibility question naming one of the customer's markets and the
//      latest measured period,
//   2. a theme question on the attribute AI answers discuss most,
//   3. a sources-with-links question on the most-cited source,
//   4. a job-function question naming one of the customer's tracked functions.
// No month-level questions, no cross-customer comparisons — by construction.
// Cached per organization for 24 hours in chat_org_settings. When the org has
// no measured data yet, the four questions from
// docs/connect-your-ai-assistant.md are returned instead.

import { executeTool } from '../_shared/px-tools/mod.ts';
import type { ToolContext } from '../_shared/px-tools/mod.ts';

export const FALLBACK_STARTERS: readonly string[] = [
  'Why did our score dip versus last quarter?',
  'What changed on wellbeing, and which sources are behind it?',
  'Which Glassdoor pages come up most, with links?',
  'Show visibility by job function.',
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SOURCE_NAMES: Record<string, string> = {
  'glassdoor.com': 'Glassdoor', 'indeed.com': 'Indeed', 'linkedin.com': 'LinkedIn', 'reddit.com': 'Reddit',
  'comparably.com': 'Comparably', 'ambitionbox.com': 'AmbitionBox', 'kununu.com': 'kununu', 'wikipedia.org': 'Wikipedia',
  'quora.com': 'Quora', 'levels.fyi': 'Levels.fyi', 'teamblind.com': 'Blind', 'fishbowlapp.com': 'Fishbowl',
};
function prettyDomain(domain: string): string {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return SOURCE_NAMES[d] ?? d;
}

function bareQuarter(label: unknown): string | null {
  const s = typeof label === 'string' ? label.replace(/ \(in progress\)$/, '') : '';
  return /^Q[1-4] \d{4}$/.test(s) ? s : null;
}

function distinct(values: unknown): string[] {
  return Array.from(new Set(((values as unknown[]) || []).map(v => String(v ?? '').trim()).filter(Boolean))).sort();
}

export interface StarterResult {
  questions: string[];
  source: 'data' | 'fallback';
}

async function buildFromData(ctx: ToolContext): Promise<string[] | null> {
  const companies = JSON.parse(await executeTool(ctx, 'list_companies', {}));
  const busiest = ((companies?.companies as any[]) || [])
    .filter(c => (c.total_responses || 0) > 0)
    .sort((a, b) => (b.total_responses || 0) - (a.total_responses || 0))[0];
  if (!busiest) return null;

  const overview = JSON.parse(await executeTool(ctx, 'get_company_overview', { company_id: busiest.id }));
  if (overview?.error || overview?._coverage?.status === 'no_data') return null;

  // Brand scope ids (same-name profiles), for the market / function lists.
  const brandIds = ((companies.companies as any[]) || [])
    .filter(c => String(c.name || '').trim().toLowerCase() === String(busiest.name || '').trim().toLowerCase())
    .map(c => c.id);
  const [marketsRes, functionsRes] = await Promise.all([
    ctx.admin.rpc('mcp_list_location_buckets', { p_company_ids: brandIds }),
    ctx.admin.rpc('mcp_list_job_function_buckets', { p_company_ids: brandIds }),
  ]);
  const markets = distinct(marketsRes.data);
  const functions = distinct(functionsRes.data);

  const period = bareQuarter(overview?._meta?.latest_period) ?? bareQuarter(overview?.metrics?.period);
  const topAttribute = (overview?.top_attributes as any[] | undefined)?.[0]?.attribute;
  const topSource = (overview?.top_sources as any[] | undefined)?.[0]?.domain;
  const hasPrevious = overview?._coverage?.has_previous_period === true;
  const market = markets[0];
  const fn = functions[0];

  const q1 = market
    ? (period ? `How visible are we in ${market} in ${period}?` : `How visible are we in ${market}?`)
    : (period ? `How visible are we in ${period}?` : 'How visible are we across AI platforms?');
  const q2 = topAttribute
    ? (hasPrevious
        ? `What changed on ${String(topAttribute).toLowerCase()} since last quarter, and which sources are behind it?`
        : `What do AI platforms say about our ${String(topAttribute).toLowerCase()}?`)
    : 'What themes come up most in AI answers about us?';
  const q3 = topSource
    ? `Which ${prettyDomain(String(topSource))} pages come up most, with links?`
    : 'Which sources do AI platforms cite about us, with links?';
  const q4 = fn ? `How does AI describe us for ${fn} roles?` : 'Show visibility by job function.';
  return [q1, q2, q3, q4];
}

export async function getStarterQuestions(ctx: ToolContext): Promise<StarterResult> {
  const { admin, organizationId } = ctx;
  const { data: row } = await admin
    .from('chat_org_settings')
    .select('starter_questions, starters_generated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const cachedAt = row?.starters_generated_at ? Date.parse(row.starters_generated_at) : NaN;
  if (Array.isArray(row?.starter_questions) && row.starter_questions.length === 4 &&
      Number.isFinite(cachedAt) && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { questions: row.starter_questions.map(String), source: 'data' };
  }

  let questions: string[] | null = null;
  try { questions = await buildFromData(ctx); }
  catch (err) { console.warn(`[${ctx.requestId}] starters build failed:`, err); }
  if (!questions) return { questions: [...FALLBACK_STARTERS], source: 'fallback' };

  // Cache; a fresh row gets the table defaults for cap/enabled, an existing
  // row keeps its cap.
  await admin.from('chat_org_settings').upsert(
    { organization_id: organizationId, starter_questions: questions, starters_generated_at: new Date().toISOString() },
    { onConflict: 'organization_id' },
  );
  return { questions, source: 'data' };
}
