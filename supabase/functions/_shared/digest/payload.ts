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
import { bandLabel } from '../px-tools/bands.ts';
import { resolveScope } from '../px-tools/scope.ts';
import type { ResolvedScope, ToolContext } from '../px-tools/scope.ts';
import { CLAUDE_PUBLISHED_OR, EXCLUDED_AI_MODELS_FILTER, monthToQuarter, pct, pointsDelta, sentimentPct } from '../px-tools/helpers.ts';
import { REGIONS, regionFromKey } from '../regions.ts';
import { buildSourceLines, sourceDisplayName } from '../source-platforms.ts';
import type { OwnedEntry } from '../source-platforms.ts';
import { readLineCounts, readOwnedEntries } from '../px-tools/source-lines.ts';
import type { DomainStatRow } from '../px-tools/source-lines.ts';
import type { DigestActionRow, DigestAttributeRow, DigestBarRow, DigestGroupRow, DigestLikeForLike, DigestPayload } from './types.ts';

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

// The previous collection, named by quarter ("Q3"), never by month (Karim,
// 2026-11-04). The year is added only when it differs from this quarter's.
export function previousWaveLabel(_months: string[], previousQuarter: string | null, latestQuarter?: string | null): string | null {
  if (!previousQuarter) return null;
  const [q, year] = previousQuarter.split(' ');
  const latestYear = latestQuarter?.split(' ')[1];
  return latestYear && year && latestYear !== year ? previousQuarter : q;
}

// Label for the saved location key, from the matched tracked spellings.
export function describeLocation(locationKey: string | null, matched: string[]): { label: string; preposition: 'in' | 'across' } {
  if (!locationKey) return { label: 'all tracked markets', preposition: 'across' };
  const region = regionFromKey(locationKey);
  if (region) return { label: region.label, preposition: 'across' };
  if (locationKey.startsWith('set:')) {
    const names = (matched.length ? matched : locationKey.slice(4).split('|').map(titleCase)).map(displayMarket);
    return { label: names.join(', '), preposition: names.length > 1 ? 'across' : 'in' };
  }
  const shown = matched.map(displayMarket);
  const name = shown.length === 1 ? shown[0] : shown.length > 1 ? shown.join(', ') : titleCase(locationKey);
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
        name: displayMarket(name),
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

// Every host cited in the quarter, as the domain cube spells it. The limit is
// the RPC's maximum so a platform's long-tail country sites are not cut off
// before they are folded into the platform's line.
async function domainRows(ctx: ToolContext, r: ResolvedScope, quarter: string): Promise<DomainStatRow[]> {
  const months = monthsOfQuarter(r, quarter);
  if (!months.length) return [];
  const { data, error } = await ctx.admin.rpc('mcp_get_domain_stats', {
    p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions,
    p_months: months, p_limit: 1000,
  });
  if (error) throw new Error(`Domain stats read failed: ${error.message}`);
  return ((data?.rows || []) as any[]).map(row => ({
    domain: String(row.domain),
    responses_citing: row.responses_citing || 0,
    mentioned_responses_citing: row.mentioned_responses_citing || 0,
    citation_count: row.citation_count || 0,
  }));
}

// Employers named on the open "which employers should I consider" questions
// (prompt_type discovery): the one place the client and its peers are
// measured on the same footing. Rows carry the prompt type, so this is a
// filter on the competitor cube read.
const DISCOVERY = 'discovery';

// Visibility on the questions asked in both quarters. When this quarter adds
// questions, a headline visibility change can come from the new questions
// rather than from how AI treats the client; this gives the like-for-like
// figure and the new questions' share, so the prose states the reason
// instead of guessing one. Scoped to one view and two quarters; paged, and
// skipped (null) above MAX_LFL_ROWS answers.
const MAX_LFL_ROWS = 40000;
const MIN_NEW_QUESTION_SHARE = 5;
async function visibilityLikeForLike(
  ctx: ToolContext, r: ResolvedScope, latestQ: string, previousQ: string | null,
): Promise<DigestLikeForLike | null> {
  if (!previousQ) return null;
  const latestMonths = monthsOfQuarter(r, latestQ);
  const prevMonths = monthsOfQuarter(r, previousQ);
  if (!latestMonths.length || !prevMonths.length) return null;
  const rows: Array<{ pid: string; latest: boolean; named: boolean }> = [];
  for (let from = 0; from < MAX_LFL_ROWS; from += 1000) {
    let q = ctx.admin.from('prompt_responses')
      .select('id, confirmed_prompt_id, response_month, company_mentioned, confirmed_prompts!inner(location_context, job_function_context)')
      .in('company_id', r.scope.companyIds)
      .in('response_month', latestMonths.concat(prevMonths))
      .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
      .or(CLAUDE_PUBLISHED_OR)
      .order('id')
      .range(from, from + 999);
    if (r.buckets) q = q.in('confirmed_prompts.location_context', r.buckets);
    if (r.jobFunctions) q = q.in('confirmed_prompts.job_function_context', r.jobFunctions);
    const { data, error } = await q;
    if (error) { console.warn(`[digest] like-for-like read failed: ${error.message}`); return null; }
    for (const row of (data || []) as any[]) {
      rows.push({ pid: String(row.confirmed_prompt_id), latest: latestMonths.includes(String(row.response_month)), named: !!row.company_mentioned });
    }
    if (!data || data.length < 1000) {
      return likeForLikeFromRows(rows, async (ids) => {
        const { data: prompts } = await ctx.admin.from('confirmed_prompts').select('prompt_text').in('id', ids);
        return ((prompts || []) as any[]).map(p => String(p.prompt_text || '')).filter(Boolean);
      });
    }
  }
  return null;
}

export async function likeForLikeFromRows(
  rows: Array<{ pid: string; latest: boolean; named: boolean }>,
  examplesFor: (ids: string[]) => Promise<string[]> = async () => [],
): Promise<DigestLikeForLike | null> {
  const prevIds = new Set(rows.filter(x => !x.latest).map(x => x.pid));
  const latestIds = new Set(rows.filter(x => x.latest).map(x => x.pid));
  const latestRows = rows.filter(x => x.latest);
  if (!latestRows.length || !prevIds.size) return null;
  const share = (xs: typeof rows) => xs.length ? Math.round(100 * xs.filter(x => x.named).length / xs.length) : null;
  const newRows = latestRows.filter(x => !prevIds.has(x.pid));
  const newShare = Math.round(100 * newRows.length / latestRows.length);
  if (newShare < MIN_NEW_QUESTION_SHARE) return null;
  const latest = share(latestRows.filter(x => prevIds.has(x.pid)));
  const previous = share(rows.filter(x => !x.latest && latestIds.has(x.pid)));
  if (latest === null || previous === null) return null;
  const newIds = Array.from(new Set(newRows.map(x => x.pid))).slice(0, 6);
  return {
    latest, previous, delta: latest - previous,
    newQuestionsSharePct: newShare, newQuestionsVisibilityPct: share(newRows),
    newQuestionExamples: (await examplesFor(newIds).catch(() => [] as string[])).slice(0, 6),
  };
}

async function competitorCounts(ctx: ToolContext, r: ResolvedScope, quarter: string, promptType: string | null) {
  const months = monthsOfQuarter(r, quarter);
  if (!months.length) return [] as Array<{ key: string; quarter: string; count: number }>;
  const { data, error } = await ctx.admin.rpc('mcp_get_competitor_stats', {
    p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions,
    p_months: months, p_limit: 60,
  });
  if (error) throw new Error(`Competitor stats read failed: ${error.message}`);
  return ((data?.rows || []) as any[])
    .filter(row => !promptType || String(row.prompt_type || '') === promptType)
    .map(row => ({ key: String(row.competitor_name), quarter, count: row.responses_mentioning || 0 }));
}

// Discovery answers in a quarter for the scope, and how many name the
// client: the denominator and the client's own row for the employers list.
// Same platform rules as the analyst tools' answer reads.
async function discoveryCounts(ctx: ToolContext, r: ResolvedScope, quarter: string): Promise<{ answers: number; mentioned: number }> {
  const months = monthsOfQuarter(r, quarter);
  if (!months.length) return { answers: 0, mentioned: 0 };
  const base = () => {
    let q = ctx.admin.from('prompt_responses')
      .select('id, confirmed_prompts!inner(prompt_type, location_context, job_function_context)', { count: 'exact', head: true })
      .in('company_id', r.scope.companyIds)
      .in('response_month', months)
      .eq('confirmed_prompts.prompt_type', DISCOVERY)
      .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
      .or(CLAUDE_PUBLISHED_OR);
    if (r.buckets) q = q.in('confirmed_prompts.location_context', r.buckets);
    if (r.jobFunctions) q = q.in('confirmed_prompts.job_function_context', r.jobFunctions);
    return q;
  };
  const [all, named] = await Promise.all([base(), base().eq('company_mentioned', true)]);
  if (all.error) throw new Error(`Discovery count failed: ${all.error.message}`);
  return { answers: all.count || 0, mentioned: named.error ? 0 : (named.count || 0) };
}

// Pretty name for a source: a platform's name (one per platform, whichever
// country site was cited), else the host. The rule is shared with every
// other surface: see ../source-platforms.ts.
export const sourceName = (domain: string): string => sourceDisplayName(domain);

// Tracked market spellings carry a leading article in some data sets
// ("the Netherlands"); the email shows the name without it.
export const displayMarket = (name: string) => name.replace(/^the\s+/i, '');

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
  const previousLabel = previousWaveLabel(r.periods.months, previousQ, latestQ);

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

  const [domainsLatest, domainsPrev, discLatest, discPrev, ownedRead] = await Promise.all([
    domainRows(ctx, r, latestQ),
    previousQ ? domainRows(ctx, r, previousQ) : Promise.resolve([] as DomainStatRow[]),
    discoveryCounts(ctx, r, latestQ),
    previousQ ? discoveryCounts(ctx, r, previousQ) : Promise.resolve({ answers: 0, mentioned: 0 }),
    readOwnedEntries(ctx, r.scope.companyIds),
  ]);
  if (ownedRead.error) throw new Error(`Owned domains read failed: ${ownedRead.error}`);
  const ownedEntries: OwnedEntry[] = ownedRead.entries;
  // Employers: discovery questions when the view has them, else all answers.
  const onDiscovery = discLatest.answers > 0;
  const [compLatest, compPrev] = await Promise.all([
    competitorCounts(ctx, r, latestQ, onDiscovery ? DISCOVERY : null),
    previousQ ? competitorCounts(ctx, r, previousQ, onDiscovery ? DISCOVERY : null) : Promise.resolve([]),
  ]);
  const employerTotals = onDiscovery
    ? new Map<string, number>([[latestQ, discLatest.answers], ...(previousQ ? [[previousQ, discPrev.answers] as [string, number]] : [])])
    : totals;
  const youPct = onDiscovery ? pct(discLatest.mentioned, discLatest.answers) : latest.visibility_pct;
  const youPrev = onDiscovery
    ? (previousQ && discPrev.answers > 0 ? pct(discPrev.mentioned, discPrev.answers) : null)
    : (previous ? previous.visibility_pct : null);
  // Sources: one line per platform (country sites folded in), a platform the
  // client owns pages on split into "your pages and posts" and "other".
  // Coverage of a merged or split line is a union of answers, never a sum.
  const answersLatest = totals.get(latestQ) || 0;
  const answersPrev = previousQ ? (totals.get(previousQ) || 0) : 0;
  const plannedLines = buildSourceLines(domainsLatest.concat(domainsPrev).map(d => d.domain), ownedEntries);
  const latestRead = await readLineCounts(ctx, r, {
    months: monthsOfQuarter(r, latestQ), lines: plannedLines, domainRows: domainsLatest, owned: ownedEntries,
    answersInScope: answersLatest, minAnswers: Math.ceil((answersLatest * MIN_SOURCE_PCT) / 100), strict: true,
  });
  const latestRows = latestRead.lines.map(l => ({ key: l.key, quarter: latestQ, count: latestRead.counts.get(l.key)?.citing || 0 }));
  const shownKeys = new Set(
    coverageRows(latestRows, totals, latestQ, null)
      .filter(s => s.pct >= MIN_SOURCE_PCT).slice(0, TOP_SOURCES).map(s => s.key),
  );
  const shownLines = latestRead.lines.filter(l => shownKeys.has(l.key));
  const prevRead = previousQ && shownLines.length
    ? await readLineCounts(ctx, r, {
      months: monthsOfQuarter(r, previousQ), lines: shownLines, domainRows: domainsPrev, owned: ownedEntries,
      answersInScope: answersPrev, strict: true,
    })
    : null;
  const sourceRows = shownLines.flatMap(l => [
    { key: l.key, quarter: latestQ, count: latestRead.counts.get(l.key)?.citing || 0 },
    ...(prevRead && previousQ ? [{ key: l.key, quarter: previousQ, count: prevRead.counts.get(l.key)?.citing || 0 }] : []),
  ]);
  const lineByKey = new Map(shownLines.map(l => [l.key, l]));
  const sources: DigestBarRow[] = coverageRows(sourceRows, totals, latestQ, previousQ)
    .map(s => {
      const line = lineByKey.get(s.key)!;
      return { domain: line.domain, name: line.name, pct: s.pct, delta: s.delta, owned: line.owned };
    });

  const brandLower = r.scope.brandName.trim().toLowerCase();
  const employers: DigestBarRow[] = coverageRows(compLatest.concat(compPrev), employerTotals, latestQ, previousQ)
    .filter(c => c.key.trim().toLowerCase() !== brandLower && c.pct > 0)
    .slice(0, TOP_EMPLOYERS)
    .map(c => ({ domain: competitorDomain(c.key), name: c.key, pct: c.pct, delta: c.delta }));
  // The brand's mark comes from its shortest whole-host entry; page entries
  // ("linkedin.com/company/x") are never a brand domain.
  const ownedHosts = ownedEntries.flatMap(e => (e.kind === 'domain' ? [e.host] : [])).sort((a, b) => a.length - b.length);
  const brandDomain = ownedHosts[0] ?? null;
  if (youPct !== null) {
    employers.push({
      domain: brandDomain ?? competitorDomain(r.scope.brandName), name: r.scope.brandName,
      pct: youPct, delta: youPrev === null ? null : pointsDelta(youPct, youPrev), you: true,
    });
  }
  // The client sits where its share puts it, not at the bottom.
  employers.sort((a, b) => b.pct - a.pct);
  // Readers took a low share here as alarming (Sreesha, 2026-11-03). Say what
  // drives it, so the figure reads as a lever rather than a verdict.
  const employersContext = onDiscovery
    ? 'AI builds these shortlists mostly from employer rankings and award lists, so a place on the lists AI reads is what moves this figure.'
    : null;
  const employersNote = onDiscovery
    ? 'Share of answers to open employer questions (candidates asking which employers to consider) that name each employer'
    : 'Share of all answers that mention each employer';

  const jobFunctions = Array.from(new Set(stats
    .filter(row => monthToQuarter(String(row.response_month)) === latestQ)
    .map(row => String(row.job_function_context || '').trim()).filter(Boolean))).sort();
  const loc = describeLocation(view.locationKey, r.buckets || []);
  const [{ open: actions, done: doneActions }, likeForLike] = await Promise.all([
    reportActions(ctx, r.buckets || [], monthsOfQuarter(r, latestQ)[0] || null),
    visibilityLikeForLike(ctx, r, latestQ, previousQ).catch(err => { console.warn(`[digest] like-for-like failed: ${err?.message || err}`); return null; }),
  ]);

  return {
    recipient: view.recipient,
    brand: { name: r.scope.brandName, domain: brandDomain },
    scope: { locationLabel: loc.label, preposition: loc.preposition, markets: (r.buckets || []).map(displayMarket), jobFunctions },
    period: { quarter: latestQ, short: shortQuarter(latestQ), previousQuarter: previousQ, previousLabel },
    metrics: {
      eps: { value: latest.eps, delta: previous ? latest.eps - previous.eps : null, grade: latest.eps_label },
      sentiment: { value: latest.positive_sentiment_pct, delta: previous ? pointsDelta(latest.positive_sentiment_pct, previous.positive_sentiment_pct) : null, grade: bandLabel('sentiment', latest.positive_sentiment_pct) },
      visibility: { value: latest.visibility_pct, delta: previous ? pointsDelta(latest.visibility_pct, previous.visibility_pct) : null, grade: bandLabel('visibility', latest.visibility_pct), likeForLike },
      relevance: { value: latest.relevance_pct, delta: previous ? pointsDelta(latest.relevance_pct, previous.relevance_pct) : null, grade: bandLabel('relevance', latest.relevance_pct) },
    },
    comparisonNote: previous
      ? `Change since ${previousLabel} compares this quarter's collection with the previous one, as the dashboard does.`
      : 'This is the first collection for this view, so there is no change to show yet.',
    sentimentChangeHidden: false,
    byFunction, byMarket, employers, employersNote, employersContext, sources, attributes, actions, doneActions,
    narrative: null,
    chatUrl: view.chatUrl,
    chatNote: view.chatNote,
  };
}

export const regionNames = () => REGIONS.map(r => r.label);

// ─── Report actions ─────────────────────────────────────────────────────────
// The numbered actions PerceptionX published in the client's report live in
// company_actions (loaded by a migration per report, read by Ask AI). The
// email shows the open ones whose markets overlap the reader's view, plus
// organisation-wide ones (no markets, or "Global"), so the owner of a market
// sees the actions written for it. High priority first, then Medium, Low,
// then unlabelled; the register's timing is never shown.

const normMarket = (m: string) => displayMarket(String(m || '')).trim().toLowerCase();
// Markets that mean the whole organisation (same list as the dashboard).
const ORG_WIDE = new Set(['global', 'all markets', 'worldwide']);
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const priorityOf = (raw: unknown): 'high' | 'medium' | 'low' | null =>
  raw === 'high' || raw === 'medium' || raw === 'low' ? raw : null;

export function shapeAction(a: Record<string, any>): DigestActionRow {
  const lifts = Array.isArray(a.lifts) ? a.lifts : [];
  return {
    id: a.id ? String(a.id) : '',
    number: a.action_number != null ? String(a.action_number).padStart(2, '0') : '',
    title: String(a.title || ''),
    priority: priorityOf(a.priority),
    priorityReason: a.priority_reason ? String(a.priority_reason) : null,
    markets: (a.markets || []).map((m: string) => displayMarket(String(m))),
    why: a.problem ? String(a.problem) : null,
    whatToDo: String(a.recommendation || ''),
    owner: a.owner_name ? String(a.owner_name) : null,
    lifts: lifts.map((l: any) => {
      const metric = String(l?.metric || '').trim();
      const attr = l?.attribute ? ` (${String(l.attribute).trim()})` : '';
      const market = l?.market ? ` in ${displayMarket(String(l.market))}` : '';
      return metric ? `${metric}${attr}${market}` : '';
    }).filter(Boolean),
  };
}

/**
 * Keep open, published actions (numbered or not) for this reader's view.
 * A market view gets only that market's actions: Global actions (no market,
 * or a market of Global) belong to the global team. An all-markets view is
 * the global team's, so it gets everything. High, Medium, Low, unlabelled;
 * then by number.
 */
export function filterActions(rows: Record<string, any>[], markets: string[]): DigestActionRow[] {
  const want = new Set(markets.map(normMarket));
  const rank = (a: Record<string, any>) => PRIORITY_RANK[String(a.priority)] ?? 3;
  return rows
    .filter(a => a.published_at && a.register !== 'retired' && a.register !== 'watch')
    .filter(a => !['done', 'retired'].includes(String(a.tracking_status || '')) && a.work_status !== 'done')
    .filter(a => {
      const ms: string[] = (a.markets || []).map(normMarket).filter(Boolean);
      return !want.size || ms.some(m => want.has(m));
    })
    .sort((a, b) => (rank(a) - rank(b)) || ((a.action_number ?? 999) - (b.action_number ?? 999)) || String(a.title || '').localeCompare(String(b.title || '')))
    .map(shapeAction);
}

/**
 * Actions for these markets completed in this quarter (from `since`, the
 * quarter's first month): done by the owner or by tracking, dated by the
 * owner's assertion or, failing that, the row's last update.
 */
export function filterDoneActions(rows: Record<string, any>[], markets: string[], since: string | null): Array<{ id: string; title: string; markets: string[] }> {
  if (!since) return [];
  const want = new Set(markets.map(normMarket));
  return rows
    .filter(a => a.published_at && a.register !== 'retired')
    .filter(a => a.work_status === 'done' || a.tracking_status === 'done')
    .filter(a => String(a.asserted_done_at || a.updated_at || '') >= since)
    .filter(a => {
      const ms: string[] = (a.markets || []).map(normMarket).filter(Boolean);
      return !want.size || ms.some(m => want.has(m));
    })
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    .map(a => ({ id: String(a.id || ''), title: String(a.title || ''), markets: (a.markets || []).map((m: string) => displayMarket(String(m))) }));
}

async function reportActions(ctx: ToolContext, markets: string[], since: string | null): Promise<{ open: DigestActionRow[]; done: Array<{ id: string; title: string; markets: string[] }> }> {
  const { data, error } = await ctx.admin
    .from('company_actions')
    .select('id, organization_id, register, title, cycle_raised, action_number, problem, recommendation, priority, priority_reason, lifts, owner_name, tracking_status, work_status, asserted_done_at, updated_at, markets, published_at')
    .eq('organization_id', ctx.organizationId)
    .not('published_at', 'is', null);
  if (error) { console.warn(`[digest] actions read failed: ${error.message}`); return { open: [], done: [] }; }
  const rows = (data || []).filter((a: any) => a.organization_id === ctx.organizationId);
  return { open: filterActions(rows, markets), done: filterDoneActions(rows, markets, since) };
}
