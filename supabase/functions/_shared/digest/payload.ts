// ─── Quarterly update email: numbers ────────────────────────────────────────
// Builds the DigestPayload for one member's view (brand + location selection)
// from the same cubes the dashboard and analyst tools read, through the
// px-tools scope resolver so a saved region or multi-market key matches the
// same tracked spellings the dashboard filter matches. Levels are the latest
// measured quarter; change is in points vs the previous measured quarter,
// the dashboard's delta-chip rule. Percentages only; raw counts never leave
// this module.

import { readRollups, buildAttributeRows } from '../px-tools/executors-insights.ts';
import { scoreQuarters } from '../px-tools/executors-core.ts';
import { resolveScope } from '../px-tools/scope.ts';
import type { ResolvedScope, ToolContext } from '../px-tools/scope.ts';
import { monthToQuarter, pct, pointsDelta, sentimentPct } from '../px-tools/helpers.ts';
import { REGIONS, regionFromKey } from '../regions.ts';
import type { DigestAttributeRow, DigestBarRow, DigestGroupRow, DigestPayload } from './types.ts';

export interface DigestView {
  companyId: string;
  /** Canonical location key: "india", "region:emea", "set:india|united states", or null. */
  locationKey: string | null;
  recipient: { firstName: string; email: string };
  chatUrl: string;
  chatNote: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MIN_SOURCE_PCT = 5;
const MIN_ATTRIBUTE_ANSWERS = 5;
const TOP_SOURCES = 8;
const TOP_EMPLOYERS = 5;
const TOP_ATTRIBUTES = 7;

export const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

// "Q4 2026" → "Q4 26".
export const shortQuarter = (q: string) => q.replace(/^(Q\d) \d\d(\d\d)$/, '$1 $2');

// The month the previous wave was collected in, named for prose ("July"):
// the latest measured month inside the previous quarter.
export function previousWaveLabel(months: string[], previousQuarter: string | null): string | null {
  if (!previousQuarter) return null;
  const inPrev = months.filter(m => monthToQuarter(m) === previousQuarter).sort();
  const last = inPrev[inPrev.length - 1];
  if (!last) return previousQuarter;
  const mi = Number(last.slice(5, 7)) - 1;
  return MONTHS[mi] ?? previousQuarter;
}

// Label for the saved location key, from the matched tracked spellings.
export function describeLocation(locationKey: string | null, matched: string[]): { label: string; preposition: 'in' | 'across' } {
  if (!locationKey) return { label: 'all tracked markets', preposition: 'across' };
  const region = regionFromKey(locationKey);
  if (region) return { label: region.label, preposition: 'across' };
  if (locationKey.startsWith('set:')) {
    const names = matched.length ? matched : locationKey.slice(4).split('|').map(titleCase);
    return { label: names.join(', '), preposition: names.length > 1 ? 'across' : 'in' };
  }
  const name = matched.length === 1 ? matched[0] : matched.length > 1 ? matched.join(', ') : titleCase(locationKey);
  return { label: name, preposition: matched.length > 1 ? 'across' : 'in' };
}

type Acc = { answers: number; mentioned: number; pos: number; neg: number };
const blank = (): Acc => ({ answers: 0, mentioned: 0, pos: 0, neg: 0 });
const add = (a: Acc, row: any) => {
  a.answers += row.total_responses || 0;
  a.mentioned += row.mentioned_responses || 0;
  a.pos += row.positive_themes || 0;
  a.neg += row.negative_themes || 0;
};

// Sentiment and visibility per group (job function or market), latest
// quarter with change vs the previous one. Pure: unit-tested on cube rows.
export function groupRows(
  stats: any[],
  keyOf: (row: any) => string,
  latestQuarter: string,
  previousQuarter: string | null,
): DigestGroupRow[] {
  const byKey = new Map<string, { latest: Acc; previous: Acc }>();
  for (const row of stats) {
    const k = keyOf(row).trim();
    if (!k) continue;
    const q = monthToQuarter(String(row.response_month));
    if (!byKey.has(k)) byKey.set(k, { latest: blank(), previous: blank() });
    const e = byKey.get(k)!;
    if (q === latestQuarter) add(e.latest, row);
    else if (previousQuarter && q === previousQuarter) add(e.previous, row);
  }
  return Array.from(byKey.entries())
    .filter(([, v]) => v.latest.answers > 0)
    .map(([name, v]) => {
      const positive = sentimentPct(v.latest.pos, v.latest.neg);
      const named = pct(v.latest.mentioned, v.latest.answers);
      const hasPrev = v.previous.answers > 0;
      return {
        name,
        positivePct: positive,
        sentimentDelta: hasPrev ? pointsDelta(positive, sentimentPct(v.previous.pos, v.previous.neg)) : null,
        namedPct: named,
        visibilityDelta: hasPrev ? pointsDelta(named, pct(v.previous.mentioned, v.previous.answers)) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Share of answers per key for two quarters from a per-month stats read.
// `rows` carry {key, quarter, count}; totals are answers per quarter.
export function coverageRows(
  rows: Array<{ key: string; quarter: string; count: number }>,
  totals: Map<string, number>,
  latestQuarter: string,
  previousQuarter: string | null,
): Array<{ key: string; pct: number; delta: number | null }> {
  const byKey = new Map<string, { latest: number; previous: number }>();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, { latest: 0, previous: 0 });
    const e = byKey.get(r.key)!;
    if (r.quarter === latestQuarter) e.latest += r.count;
    else if (previousQuarter && r.quarter === previousQuarter) e.previous += r.count;
  }
  const latestTotal = totals.get(latestQuarter) || 0;
  const prevTotal = previousQuarter ? (totals.get(previousQuarter) || 0) : 0;
  return Array.from(byKey.entries())
    .map(([key, v]) => ({
      key,
      pct: pct(v.latest, latestTotal) ?? 0,
      delta: prevTotal ? pointsDelta(pct(v.latest, latestTotal), pct(v.previous, prevTotal)) : null,
    }))
    .sort((a, b) => b.pct - a.pct);
}

function monthsOfQuarter(r: ResolvedScope, quarter: string): string[] {
  return r.months.filter(m => monthToQuarter(m) === quarter);
}

async function domainCounts(ctx: ToolContext, r: ResolvedScope, quarter: string) {
  const months = monthsOfQuarter(r, quarter);
  if (!months.length) return [] as Array<{ key: string; quarter: string; count: number }>;
  const { data, error } = await ctx.admin.rpc('mcp_get_domain_stats', {
    p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions,
    p_months: months, p_limit: 200,
  });
  if (error) throw new Error(`Domain stats read failed: ${error.message}`);
  return ((data?.rows || []) as any[]).map(row => ({ key: String(row.domain), quarter, count: row.responses_citing || 0 }));
}

async function competitorCounts(ctx: ToolContext, r: ResolvedScope, quarter: string) {
  const months = monthsOfQuarter(r, quarter);
  if (!months.length) return [] as Array<{ key: string; quarter: string; count: number }>;
  const { data, error } = await ctx.admin.rpc('mcp_get_competitor_stats', {
    p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions,
    p_months: months, p_limit: 40,
  });
  if (error) throw new Error(`Competitor stats read failed: ${error.message}`);
  return ((data?.rows || []) as any[]).map(row => ({ key: String(row.competitor_name), quarter, count: row.responses_mentioning || 0 }));
}

// Pretty name for a source domain: a known site's brand, else the domain.
const SOURCE_NAMES: Record<string, string> = {
  'linkedin.com': 'LinkedIn', 'glassdoor.com': 'Glassdoor', 'indeed.com': 'Indeed', 'reddit.com': 'Reddit',
  'youtube.com': 'YouTube', 'ambitionbox.com': 'AmbitionBox', 'teamblind.com': 'Blind', 'levels.fyi': 'Levels.fyi',
  'builtin.com': 'Built In', 'comparably.com': 'Comparably', 'wikipedia.org': 'Wikipedia', 'greatplacetowork.com': 'Great Place to Work',
  'quora.com': 'Quora', 'x.com': 'X', 'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'kununu.com': 'Kununu',
};
export const sourceName = (domain: string) => SOURCE_NAMES[domain] || domain;

// A competitor's mark: "General Motors" → generalmotors.com (the dashboard's guess).
export const competitorDomain = (name: string) => {
  const clean = name.trim().toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9-]/g, '');
  return clean ? `${clean}.com` : 'example.com';
};

export async function buildDigestPayload(ctx: ToolContext, view: DigestView): Promise<DigestPayload> {
  const r = await resolveScope(ctx, view.companyId, {
    location: view.locationKey ?? undefined, quartersBack: 2, includeSiblings: true,
  });
  if (typeof r === 'string') {
    const parsed = JSON.parse(r);
    throw new Error(parsed?._coverage?.reason || parsed?.error || 'No data for this view.');
  }

  const rollups = await readRollups(ctx, r);
  const scored = scoreQuarters(rollups, r);
  if (!scored.length) throw new Error('No measured quarter for this view.');
  const latest = scored[scored.length - 1];
  const previous = scored.length > 1 ? scored[scored.length - 2] : null;
  const latestQ = latest.quarter;
  const previousQ = previous?.quarter ?? null;
  const previousLabel = previousWaveLabel(r.periods.months, previousQ);

  const stats: any[] = rollups?.scope_stats || [];
  const totals = new Map<string, number>();
  for (const row of stats) {
    const q = monthToQuarter(String(row.response_month));
    totals.set(q, (totals.get(q) || 0) + (row.total_responses || 0));
  }

  // Attributes: the latest quarter's row of each attribute's quarterly series.
  const attrs = buildAttributeRows(rollups, r, { withQuarterly: true }).attributes;
  const attributes: DigestAttributeRow[] = attrs
    .map(a => {
      const q = (a.quarterly || []).find(x => String(x.quarter).startsWith(latestQ));
      const prevRow = previousQ ? (a.quarterly || []).find(x => String(x.quarter).startsWith(previousQ)) : undefined;
      if (!q) return null;
      const answers = (q.sample_size as any)?.answers_mentioning || 0;
      if (answers < MIN_ATTRIBUTE_ANSWERS) return null;
      return {
        attributeId: a.attribute_id,
        name: a.attribute,
        raisedPct: (q.mentioned_in_pct_of_answers as number | null) ?? 0,
        positivePct: (q.positive_sentiment_pct as number | null) ?? null,
        delta: prevRow ? pointsDelta(q.positive_sentiment_pct as number | null, prevRow.positive_sentiment_pct as number | null) : null,
      } as DigestAttributeRow;
    })
    .filter((x): x is DigestAttributeRow => !!x)
    .sort((a, b) => b.raisedPct - a.raisedPct)
    .slice(0, TOP_ATTRIBUTES);

  const byFunction = groupRows(stats, row => String(row.job_function_context || ''), latestQ, previousQ);
  const byMarket = r.buckets && r.buckets.length > 1
    ? groupRows(stats, row => String(row.location_context || ''), latestQ, previousQ)
    : [];

  const [domainsLatest, domainsPrev, compLatest, compPrev, ownedRes] = await Promise.all([
    domainCounts(ctx, r, latestQ),
    previousQ ? domainCounts(ctx, r, previousQ) : Promise.resolve([]),
    competitorCounts(ctx, r, latestQ),
    previousQ ? competitorCounts(ctx, r, previousQ) : Promise.resolve([]),
    ctx.admin.from('company_owned_domains').select('domain').in('company_id', r.scope.companyIds),
  ]);
  const owned = new Set<string>(((ownedRes.data || []) as any[]).map(d => String(d.domain).toLowerCase().replace(/^www\./, '')));
  const isOwned = (domain: string) => owned.has(domain) || Array.from(owned).some(o => domain.endsWith(`.${o}`) || o.endsWith(`.${domain}`));

  const sources: DigestBarRow[] = coverageRows(domainsLatest.concat(domainsPrev), totals, latestQ, previousQ)
    .filter(s => s.pct >= MIN_SOURCE_PCT)
    .slice(0, TOP_SOURCES)
    .map(s => ({ domain: s.key, name: sourceName(s.key), pct: s.pct, delta: s.delta, owned: isOwned(s.key) }));

  const brandLower = r.scope.brandName.trim().toLowerCase();
  const employers: DigestBarRow[] = coverageRows(compLatest.concat(compPrev), totals, latestQ, previousQ)
    .filter(c => c.key.trim().toLowerCase() !== brandLower && c.pct > 0)
    .slice(0, TOP_EMPLOYERS)
    .map(c => ({ domain: competitorDomain(c.key), name: c.key, pct: c.pct, delta: c.delta }));
  const ownedList = Array.from(owned).sort((a, b) => a.length - b.length);
  const brandDomain = ownedList[0] ?? null;
  if (latest.visibility_pct !== null) {
    employers.push({
      domain: brandDomain ?? competitorDomain(r.scope.brandName), name: r.scope.brandName,
      pct: latest.visibility_pct, delta: previous ? pointsDelta(latest.visibility_pct, previous.visibility_pct) : null, you: true,
    });
  }

  const jobFunctions = Array.from(new Set(stats
    .filter(row => monthToQuarter(String(row.response_month)) === latestQ)
    .map(row => String(row.job_function_context || '').trim()).filter(Boolean))).sort();
  const loc = describeLocation(view.locationKey, r.buckets || []);

  return {
    recipient: view.recipient,
    brand: { name: r.scope.brandName, domain: brandDomain },
    scope: { locationLabel: loc.label, preposition: loc.preposition, markets: r.buckets || [], jobFunctions },
    period: { quarter: latestQ, short: shortQuarter(latestQ), previousQuarter: previousQ, previousLabel },
    metrics: {
      eps: { value: latest.eps, delta: previous ? latest.eps - previous.eps : null, grade: latest.eps_label },
      sentiment: { value: latest.positive_sentiment_pct, delta: previous ? pointsDelta(latest.positive_sentiment_pct, previous.positive_sentiment_pct) : null },
      visibility: { value: latest.visibility_pct, delta: previous ? pointsDelta(latest.visibility_pct, previous.visibility_pct) : null },
      relevance: { value: latest.relevance_pct, delta: previous ? pointsDelta(latest.relevance_pct, previous.relevance_pct) : null },
    },
    comparisonNote: previous
      ? `Change since ${previousLabel} compares this quarter's collection with the previous one, as the dashboard does.`
      : 'This is the first collection for this view, so there is no change to show yet.',
    sentimentChangeHidden: false,
    byFunction, byMarket, employers, sources, attributes,
    narrative: null,
    chatUrl: view.chatUrl,
    chatNote: view.chatNote,
  };
}

export const regionNames = () => REGIONS.map(r => r.label);
