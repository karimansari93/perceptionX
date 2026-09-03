// ─── px-tools: insight executors ────────────────────────────────────────────
// The location/attribute-aware tools built for the MCP surface ("what's our
// culture like in India?"). They read the SAME stats cubes the dashboard
// reads (via service-role twin RPCs), so chat/MCP numbers match the app —
// never re-derived from raw tables.
//
// Presentation rules (client feedback + ChatGPT plugin guidelines):
//   * Periods are MEASURED quarters. Collection runs in waves; the window is
//     "the last N quarters with data", every listed period is a complete
//     wave, and an unlisted calendar quarter is not a gap. "(in progress)"
//     appears only while a wave is genuinely still writing (read from the
//     pipeline, never from today's date).
//   * Percentages lead. "% of answers" is the headline for everything —
//     visibility, attribute mentions, sources, competitors — and every raw
//     count sits under `sample_size` so a host model never narrates
//     "dropped from 3,013 to 3,000 mentions".
//   * Change is reported in percentage points against the PREVIOUS MEASURED
//     period (the dashboard's delta-chip rule).
//   * Say what's INCLUDED (tracked platforms), never what's excluded.
//   * Response minimization: no internal ids, timestamps, or diagnostics.
//
// Every result is self-caveating: `_coverage` plus `_meta` carrying the
// measured periods, matched market spellings, scope size, and methodology
// notes. Over MCP the host model never sees our system prompt, so the
// payload is the only place honesty can live.

import {
  changeBlock, coverageFound, coverageNoData, coveragePartial, EXCLUDED_AI_MODELS_FILTER,
  labelQuarter, METHODOLOGY_NOTES, monthToQuarter, pct, pointsDelta, rate1, sentimentPct,
  sortQuarters, toQuarterly, topPagesByDomain, pageEntry, PAGES_UNAVAILABLE_NOTE,
} from './helpers.ts';
import { answersByQuarter, metaFor, resolveScope } from './scope.ts';
import type { ResolvedScope, ToolContext } from './scope.ts';

// Methodology v2 attribute registry (mirrors src/config/attributes.ts /
// _shared/theme-analysis.ts — ids are stable, display names client-facing).
export const ATTRIBUTES_V2: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'mission-purpose-impact', name: 'Mission, Purpose & Impact' },
  { id: 'compensation', name: 'Compensation' },
  { id: 'company-culture', name: 'Company Culture' },
  { id: 'leadership', name: 'Leadership' },
  { id: 'job-security', name: 'Job Security' },
  { id: 'career-opportunities', name: 'Career Opportunities' },
  { id: 'wellbeing-balance', name: 'Wellbeing & Balance' },
  { id: 'inclusion', name: 'Inclusion' },
  { id: 'innovation', name: 'Innovation' },
  { id: 'application-communication', name: 'Application Communication' },
  { id: 'candidate-feedback', name: 'Candidate Feedback' },
  { id: 'interview-experience', name: 'Interview Experience' },
  { id: 'onboarding-experience', name: 'Onboarding Experience' },
];
const ATTRIBUTE_ID_SET = new Set(ATTRIBUTES_V2.map(a => a.id));
export const attributeName = (id: string): string => ATTRIBUTES_V2.find(a => a.id === id)?.name || id;

// Common phrasings → attribute id, so a host model's first call lands
// ("who's our top competitor for pay?" → compensation) instead of costing a
// visible retry round-trip. Kept small and unambiguous.
const ATTRIBUTE_ALIASES: Record<string, string> = {
  'pay': 'compensation', 'salary': 'compensation', 'salaries': 'compensation',
  'benefits': 'compensation', 'perks': 'compensation', 'comp': 'compensation',
  'culture': 'company-culture', 'work culture': 'company-culture',
  'work-life balance': 'wellbeing-balance', 'work life balance': 'wellbeing-balance',
  'wellbeing': 'wellbeing-balance', 'well-being': 'wellbeing-balance', 'wellness': 'wellbeing-balance',
  'balance': 'wellbeing-balance',
  'career': 'career-opportunities', 'career growth': 'career-opportunities',
  'growth': 'career-opportunities', 'progression': 'career-opportunities',
  'diversity': 'inclusion', 'dei': 'inclusion', 'inclusion & diversity': 'inclusion',
  'mission': 'mission-purpose-impact', 'purpose': 'mission-purpose-impact', 'impact': 'mission-purpose-impact',
  'management': 'leadership', 'managers': 'leadership',
  'stability': 'job-security', 'layoffs': 'job-security',
  'interviews': 'interview-experience', 'interviewing': 'interview-experience',
  'onboarding': 'onboarding-experience',
  'application': 'application-communication', 'applying': 'application-communication',
};

// Accept an exact id, a display name, a common alias, or an unambiguous
// substring. Anything else returns null and the caller emits a recoverable
// error listing the valid ids.
export function resolveAttributeId(input: string | undefined | null): string | null {
  if (!input) return null;
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const byId = ATTRIBUTES_V2.find(a => a.id === q);
  if (byId) return byId.id;
  const byName = ATTRIBUTES_V2.find(a => a.name.toLowerCase() === q);
  if (byName) return byName.id;
  if (ATTRIBUTE_ALIASES[q]) return ATTRIBUTE_ALIASES[q];
  const contains = ATTRIBUTES_V2.filter(a =>
    a.name.toLowerCase().includes(q) || a.id.includes(q.replace(/\s+/g, '-')));
  return contains.length === 1 ? contains[0].id : null;
}

const ATTRIBUTE_IDS_HELP = ATTRIBUTES_V2.map(a => a.id).join(', ');

export function unknownAttributeError(input: string): string {
  return JSON.stringify({ error: `Unknown attribute "${input}". Valid attribute ids: ${ATTRIBUTE_IDS_HELP}.` });
}

// ─── Cube reads ─────────────────────────────────────────────────────────────

export async function readRollups(ctx: ToolContext, r: ResolvedScope): Promise<any> {
  const { data, error } = await ctx.admin.rpc('mcp_get_rollups', {
    p_company_ids: r.scope.companyIds,
    p_buckets: r.buckets,
    p_months: r.months,
  });
  if (error) throw new Error(`Rollup read failed: ${error.message}`);
  return data || {};
}

const sumOf = (m: Map<string, number>): number => Array.from(m.values()).reduce((s, v) => s + v, 0);

// ─── Attribute rows ─────────────────────────────────────────────────────────
// Shared by get_attribute_themes, get_attribute_breakdown and the overview.
// "% of answers that discuss the attribute" leads (the client's requested
// framing), the dashboard's share-of-themes mix rides along, raw counts nest
// under sample_size.
export interface AttributeRow {
  attribute_id: string;
  attribute: string;
  mentioned_in_pct_of_answers: number | null;
  positive_sentiment_pct: number | null;
  share_of_themes_pct: number | null;
  change_vs_previous_period?: Record<string, unknown>;
  quarterly?: Array<Record<string, unknown>>;
  sample_size: { answers_mentioning: number; themes: number; positive_themes: number; negative_themes: number; neutral_themes: number };
}

export function buildAttributeRows(
  rollups: any,
  r: ResolvedScope,
  opts: { focus?: string | null; withQuarterly: boolean }
): { attributes: AttributeRow[]; totalAnswers: number; allThemes: number } {
  const rows: any[] = (rollups?.attribute_themes || []).filter(
    (row: any) => ATTRIBUTE_ID_SET.has(String(row.attribute_id || '').trim())
  );
  const answersQ = answersByQuarter(rollups?.scope_stats || []);
  const totalAnswers = sumOf(answersQ);

  // Per-quarter theme totals across ALL attributes (share_of_themes denominator).
  const themesQ = new Map<string, number>();
  for (const row of rows) {
    const q = monthToQuarter(String(row.response_month));
    themesQ.set(q, (themesQ.get(q) || 0) + (row.total_themes || 0));
  }
  const allThemes = sumOf(themesQ);

  type Acc = { total: number; pos: number; neg: number; neu: number; responses: number };
  const blank = (): Acc => ({ total: 0, pos: 0, neg: 0, neu: 0, responses: 0 });
  const add = (a: Acc, row: any) => {
    a.total += row.total_themes || 0;
    a.pos += row.positive_themes || 0;
    a.neg += row.negative_themes || 0;
    a.neu += row.neutral_themes || 0;
    a.responses += row.response_count || 0;
  };
  const byAttr = new Map<string, { all: Acc; byQ: Map<string, Acc> }>();
  for (const row of rows) {
    const id = String(row.attribute_id).trim();
    if (opts.focus && id !== opts.focus) continue;
    if (!byAttr.has(id)) byAttr.set(id, { all: blank(), byQ: new Map() });
    const entry = byAttr.get(id)!;
    add(entry.all, row);
    const q = monthToQuarter(String(row.response_month));
    if (!entry.byQ.has(q)) entry.byQ.set(q, blank());
    add(entry.byQ.get(q)!, row);
  }

  const attributes: AttributeRow[] = Array.from(byAttr.entries()).map(([id, a]) => {
    const quarterly = sortQuarters(a.byQ.keys()).map(q => {
      const v = a.byQ.get(q)!;
      return {
        quarter: labelQuarter(q, r.inProgressQuarter),
        mentioned_in_pct_of_answers: pct(v.responses, answersQ.get(q) || 0),
        positive_sentiment_pct: sentimentPct(v.pos, v.neg),
        share_of_themes_pct: pct(v.total, themesQ.get(q) || 0),
        sample_size: { answers_mentioning: v.responses, themes: v.total },
      };
    });
    const last = quarterly[quarterly.length - 1];
    const prev = quarterly[quarterly.length - 2];
    const change = last && prev ? {
      previous_period: prev.quarter,
      mentioned_pct_points: pointsDelta(last.mentioned_in_pct_of_answers, prev.mentioned_in_pct_of_answers),
      sentiment_points: pointsDelta(last.positive_sentiment_pct, prev.positive_sentiment_pct),
      share_of_themes_points: pointsDelta(last.share_of_themes_pct, prev.share_of_themes_pct),
    } : null;
    return {
      attribute_id: id,
      attribute: attributeName(id),
      mentioned_in_pct_of_answers: pct(a.all.responses, totalAnswers),
      positive_sentiment_pct: sentimentPct(a.all.pos, a.all.neg),
      share_of_themes_pct: pct(a.all.total, allThemes),
      ...(change ? { change_vs_previous_period: change } : {}),
      ...(opts.withQuarterly ? { quarterly } : {}),
      sample_size: {
        answers_mentioning: a.all.responses, themes: a.all.total,
        positive_themes: a.all.pos, negative_themes: a.all.neg, neutral_themes: a.all.neu,
      },
    };
  }).sort((x, y) =>
    ((y.mentioned_in_pct_of_answers ?? -1) - (x.mentioned_in_pct_of_answers ?? -1))
    || (y.sample_size.answers_mentioning - x.sample_size.answers_mentioning));

  return { attributes, totalAnswers, allThemes };
}

// ─── get_attribute_themes ───────────────────────────────────────────────────
// "What's our culture like in India?" — attribute × market from the
// dashboard cube, by measured quarter, plus real theme quotes and the
// sources cited in those answers when a single attribute is in focus.
export async function getAttributeThemes(
  ctx: ToolContext,
  companyId: string,
  attributeInput: string | undefined,
  location: string | undefined,
  quartersBack: number,
  includeSiblings: boolean
): Promise<string> {
  const attributeId = attributeInput ? resolveAttributeId(attributeInput) : null;
  if (attributeInput && !attributeId) return unknownAttributeError(attributeInput);

  const r = await resolveScope(ctx, companyId, { location, quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  let rollups: any;
  try { rollups = await readRollups(ctx, r); } catch (err: any) { return JSON.stringify({ error: err.message }); }

  const built = buildAttributeRows(rollups, r, { focus: attributeId, withQuarterly: true });
  if (!built.attributes.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No theme data for ${attributeId ? attributeName(attributeId) : 'any attribute'}${r.buckets ? ` in ${r.buckets.join('/')}` : ''} across the measured periods ${r.quarters.join(', ')}.`,
        r.available.length ? { available_markets: r.available } : {}
      ),
      _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment]),
    });
  }

  // Real quotes + the sources in play when a single attribute is in focus —
  // the "what are people actually saying, and from where" half of the
  // answer. Quotes span the window; the source breakdown is scoped to the
  // LATEST measured quarter (the period a "why did this change" question is
  // about, and a bounded read: a brand-wide multi-quarter scan of citation
  // JSON exceeds the PostgREST statement budget). No ids or dates.
  let quotes: any[] = [];
  let sourcesBlock: Record<string, unknown> | undefined;
  if (attributeId) {
    const latestQuarter = r.quarters[r.quarters.length - 1];
    const latestMonths = r.months.filter(m => monthToQuarter(m) === latestQuarter);
    let q = ctx.admin
      .from('ai_themes')
      .select('theme_name, sentiment, context_snippets, keywords, created_at, prompt_responses!inner(ai_model, response_month, confirmed_prompts!inner(location_context))')
      .in('company_id', r.scope.companyIds)
      .eq('attribute_id', attributeId)
      .not('prompt_responses.ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
      .in('prompt_responses.response_month', r.months)
      .order('created_at', { ascending: false })
      .limit(40);
    if (r.buckets) q = q.in('prompt_responses.confirmed_prompts.location_context', r.buckets);

    const [themeRes, sourcesRes] = await Promise.all([
      q,
      ctx.admin.rpc('mcp_get_attribute_sources', {
        p_company_ids: r.scope.companyIds,
        p_attribute_id: attributeId,
        p_buckets: r.buckets,
        p_months: latestMonths,
        p_limit: 10,
      }),
    ]);

    const seen = new Set<string>();
    for (const t of (themeRes.data || [])) {
      const snippet = (t.context_snippets || [])[0];
      const key = `${t.theme_name}|${t.sentiment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      quotes.push({
        theme: t.theme_name,
        sentiment: t.sentiment,
        snippet: snippet ? String(snippet).slice(0, 260) : null,
        keywords: (t.keywords || []).slice(0, 4),
        ai_platform: t.prompt_responses?.ai_model ?? null,
      });
      if (quotes.length >= 14) break;
    }

    // Percentages are of a random sample (up to 1,500) of the answers that
    // discuss the attribute in the latest period — the payload says so.
    const answersSampled = Number(sourcesRes.data?.answers_sampled) || 0;
    const periodLabel = labelQuarter(latestQuarter, r.inProgressQuarter);
    sourcesBlock = sourcesRes.error
      ? {
          period: periodLabel,
          note: `The source breakdown for ${attributeName(attributeId)} could not be computed for this scope right now; ask again with a single market (location) to narrow it.`,
          sources: [],
        }
      : {
          period: periodLabel,
          note: `Domains cited in the ${periodLabel} answers that discuss ${attributeName(attributeId)} (a random sample of ${answersSampled} answers) — where this topic is being sourced from, with the most-cited pages on each (top_pages — link these). Association, not cause.`,
          sources: ((sourcesRes.data?.rows as any[]) || []).map((row: any) => ({
            domain: row.domain,
            cited_in_pct_of_attribute_answers: pct(row.answers_citing || 0, answersSampled),
            top_pages: ((row.top_pages as any[]) || [])
              .map((p: any) => pageEntry(p, answersSampled, 'cited_in_pct_of_attribute_answers'))
              .filter(Boolean),
            sample_size: { answers_citing: row.answers_citing || 0 },
          })),
          sample_size: { answers_sampled: answersSampled },
        };
  }

  return JSON.stringify({
    attributes: built.attributes,
    ...(attributeId ? {
      focus_attribute: attributeId,
      example_themes: quotes,
      sources_in_attribute_answers: sourcesBlock,
    } : {}),
    sample_size: { answers: built.totalAnswers, themes: built.allThemes },
    _coverage: coverageFound({ attribute_count: built.attributes.length, periods: r.quarters.length }),
    _meta: metaFor(r, [
      METHODOLOGY_NOTES.sentiment, METHODOLOGY_NOTES.attribute_share,
      ...(attributeId ? [METHODOLOGY_NOTES.pages] : []),
    ]),
  });
}

// ─── get_visibility ─────────────────────────────────────────────────────────
export async function getVisibility(
  ctx: ToolContext,
  companyId: string,
  location: string | undefined,
  quartersBack: number,
  byModel: boolean,
  includeSiblings: boolean
): Promise<string> {
  const r = await resolveScope(ctx, companyId, { location, quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  let rollups: any;
  try { rollups = await readRollups(ctx, r); } catch (err: any) { return JSON.stringify({ error: err.message }); }

  const stats: any[] = rollups?.scope_stats || [];
  if (!stats.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No answer data${r.buckets ? ` for ${r.buckets.join('/')}` : ''} across the measured periods ${r.quarters.join(', ')}.`,
        r.available.length ? { available_markets: r.available } : {}
      ),
      _meta: metaFor(r, [METHODOLOGY_NOTES.visibility]),
    });
  }

  let total = 0, mentioned = 0;
  for (const row of stats) {
    total += row.total_responses || 0;
    mentioned += row.mentioned_responses || 0;
  }

  const quarterly = toQuarterly(stats, (row) => ({
    _total: row.total_responses || 0,
    _mentioned: row.mentioned_responses || 0,
  }), r.inProgressQuarter).map(({ quarter, _total, _mentioned }) => ({
    quarter,
    visibility_pct: pct(_mentioned, _total),
    sample_size: { answers: _total, answers_mentioning_company: _mentioned },
  }));

  let platforms: any[] | undefined;
  if (byModel) {
    const byModelMap = new Map<string, { total: number; mentioned: number }>();
    for (const row of (rollups?.llm_stats || [])) {
      const k = row.ai_model || 'unknown';
      if (!byModelMap.has(k)) byModelMap.set(k, { total: 0, mentioned: 0 });
      const mm = byModelMap.get(k)!;
      mm.total += row.total_responses || 0;
      mm.mentioned += row.mentions || 0;
    }
    platforms = Array.from(byModelMap.entries())
      .map(([platform, v]) => ({
        platform,
        visibility_pct: pct(v.mentioned, v.total),
        sample_size: { answers: v.total, answers_mentioning_company: v.mentioned },
      }))
      .sort((a, b) => (b.visibility_pct ?? -1) - (a.visibility_pct ?? -1));
  }

  return JSON.stringify({
    visibility_pct: pct(mentioned, total),
    quarterly,
    change: changeBlock(quarterly.map(q => ({ quarter: q.quarter, value: q.visibility_pct })), r.inProgressQuarter),
    ...(platforms ? { by_platform: platforms } : {}),
    sample_size: { answers: total, answers_mentioning_company: mentioned },
    _coverage: coverageFound({ periods: quarterly.length }),
    _meta: metaFor(r, [METHODOLOGY_NOTES.visibility]),
  });
}

// ─── get_sources ────────────────────────────────────────────────────────────
// Canonical citation domains for the scope, led by the share of answers
// citing each, with the "answer gap": answers citing the domain where the
// company was NOT mentioned — the outreach surface ("sources talking about
// your space without you").
export async function getSources(
  ctx: ToolContext,
  companyId: string,
  location: string | undefined,
  quartersBack: number,
  gapOnly: boolean,
  limit: number,
  includeSiblings: boolean
): Promise<string> {
  const r = await resolveScope(ctx, companyId, { location, quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const [domainRes, rollupsRes, pagesRes] = await Promise.all([
    ctx.admin.rpc('mcp_get_domain_stats', {
      p_company_ids: r.scope.companyIds,
      p_buckets: r.buckets,
      p_months: r.months,
      p_limit: Math.max(limit * 3, 100), // headroom before gap filtering
    }),
    ctx.admin.rpc('mcp_get_rollups', {
      p_company_ids: r.scope.companyIds,
      p_buckets: r.buckets,
      p_months: r.months,
    }),
    // Most-cited pages per domain (url + title) from the page cube — the
    // links a host needs to cite a source properly. Same denominator as the
    // domain shares.
    ctx.admin.rpc('mcp_get_cited_pages', {
      p_company_ids: r.scope.companyIds,
      p_buckets: r.buckets,
      p_months: r.months,
      p_limit: Math.max(limit * 3, 90),
      p_per_domain: 3,
    }),
  ]);
  const { data, error } = domainRes;
  if (error) return JSON.stringify({ error: `Domain stats read failed: ${error.message}` });
  const totalResponses = ((rollupsRes.data?.scope_stats || []) as any[])
    .reduce((sum, row) => sum + (row.total_responses || 0), 0);

  const rows: any[] = data?.rows || [];
  if (!rows.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No citation data${r.buckets ? ` for ${r.buckets.join('/')}` : ''} across the measured periods ${r.quarters.join(', ')}.`,
        r.available.length ? { available_markets: r.available } : {}
      ),
      _meta: metaFor(r),
    });
  }

  const byDomain = new Map<string, { citing: number; mentionedCiting: number; citations: number }>();
  for (const row of rows) {
    const d = row.domain;
    if (!byDomain.has(d)) byDomain.set(d, { citing: 0, mentionedCiting: 0, citations: 0 });
    const e = byDomain.get(d)!;
    e.citing += row.responses_citing || 0;
    e.mentionedCiting += row.mentioned_responses_citing || 0;
    e.citations += row.citation_count || 0;
  }

  // Shares lead, raw counts nest under sample_size: "cited by 31% of
  // answers" is the useful stat; counts stay only as sample-size context.
  let sources = Array.from(byDomain.entries()).map(([domain, v]) => {
    const gap = Math.max(0, v.citing - v.mentionedCiting);
    return {
      domain,
      cited_in_pct_of_answers: pct(v.citing, totalResponses),
      answer_gap_pct_of_answers: pct(gap, totalResponses),   // cited while the company was absent
      gap_rate_pct: pct(gap, v.citing),                      // of its citing answers, % where company absent
      sample_size: {
        answers_citing: v.citing,
        answers_citing_with_company_mentioned: v.mentionedCiting,
        answer_gap: gap,
        citations: v.citations,
      },
    };
  });

  sources = gapOnly
    ? sources.filter(s => s.sample_size.answer_gap > 0).sort((a, b) => b.sample_size.answer_gap - a.sample_size.answer_gap)
    : sources.sort((a, b) => b.sample_size.answers_citing - a.sample_size.answers_citing);
  const pagesByDomain = pagesRes.error
    ? new Map<string, Record<string, unknown>[]>()
    : topPagesByDomain(pagesRes.data?.rows || [], totalResponses, 'cited_in_pct_of_answers');
  const sourcesWithPages = sources.slice(0, limit).map(({ sample_size, ...s }) => ({
    ...s,
    top_pages: pagesByDomain.get(s.domain) || [],
    sample_size,
  }));

  return JSON.stringify({
    sources: sourcesWithPages,
    sample_size: {
      answers: totalResponses,
      distinct_domains: data?.domain_total ?? byDomain.size,
    },
    _coverage: coverageFound({
      returned: sourcesWithPages.length,
      gap_only: gapOnly,
      ...(pagesRes.error ? { pages_note: PAGES_UNAVAILABLE_NOTE } : {}),
    }),
    _meta: metaFor(r, [
      'Domains are canonicalized (regional variants collapse to one root).',
      '"answer_gap" = answers citing this domain where the company was NOT mentioned — the outreach opportunity surface.',
      METHODOLOGY_NOTES.pages,
    ]),
  });
}

// ─── get_competitor_landscape ───────────────────────────────────────────────
export async function getCompetitorLandscape(
  ctx: ToolContext,
  companyId: string,
  location: string | undefined,
  attributeInput: string | undefined,
  quartersBack: number,
  limit: number,
  includeSiblings: boolean
): Promise<string> {
  const attributeId = attributeInput ? resolveAttributeId(attributeInput) : null;
  if (attributeInput && !attributeId) return unknownAttributeError(attributeInput);

  const r = await resolveScope(ctx, companyId, { location, quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const [statsRes, rollupsRes] = await Promise.all([
    ctx.admin.rpc('mcp_get_competitor_stats', {
      p_company_ids: r.scope.companyIds,
      p_buckets: r.buckets,
      p_months: r.months,
      p_limit: limit,
    }),
    ctx.admin.rpc('mcp_get_rollups', {
      p_company_ids: r.scope.companyIds,
      p_buckets: r.buckets,
      p_months: r.months,
    }),
  ]);
  if (statsRes.error) return JSON.stringify({ error: `Competitor stats read failed: ${statsRes.error.message}` });

  const totalResponses = ((rollupsRes.data?.scope_stats || []) as any[])
    .reduce((s, row) => s + (row.total_responses || 0), 0);

  const byName = new Map<string, { responses: number; coMentions: number; byType: Map<string, number> }>();
  for (const row of (statsRes.data?.rows || [])) {
    const n = row.competitor_name;
    if (!byName.has(n)) byName.set(n, { responses: 0, coMentions: 0, byType: new Map() });
    const e = byName.get(n)!;
    e.responses += row.responses_mentioning || 0;
    e.coMentions += row.co_mentions || 0;
    const t = row.prompt_type || 'unspecified';
    e.byType.set(t, (e.byType.get(t) || 0) + (row.responses_mentioning || 0));
  }

  const competitors = Array.from(byName.entries()).map(([name, v]) => ({
    name,
    named_in_pct_of_answers: pct(v.responses, totalResponses),
    named_alongside_company_pct_of_answers: pct(v.coMentions, totalResponses),
    sample_size: {
      answers_naming: v.responses,
      answers_naming_alongside_company: v.coMentions,
      by_prompt_type: Object.fromEntries(v.byType),
    },
  })).sort((a, b) => b.sample_size.answers_naming - a.sample_size.answers_naming).slice(0, limit);

  // Attribute lens: share-of-voice on prompts carrying the attribute, plus
  // whatever competitor sentiment themes exist (a newer signal, accruing
  // forward from Q3 2026). Both blocks self-describe their limits — SOV is
  // "who gets named when <attribute> comes up", NOT competitor sentiment.
  let attributeBlock: Record<string, unknown> | undefined;
  if (attributeId) {
    const [sovRes, triplesRes] = await Promise.all([
      ctx.admin.rpc('mcp_get_attribute_competitors', {
        p_company_ids: r.scope.companyIds,
        p_attribute_id: attributeId,
        p_self_name: r.scope.brandName,
        p_buckets: r.buckets,
        p_months: r.months,
        p_limit: limit,
      }),
      ctx.admin
        .from('competitor_themes')
        .select('competitor_name, sentiment, context_snippet')
        .in('company_id', r.scope.companyIds)
        .eq('attribute_id', attributeId)
        .limit(200),
    ]);

    const sov = sovRes.data || {};
    const triples: any[] = triplesRes.data || [];
    const tripleAgg = new Map<string, { pos: number; neg: number; neu: number; snippet: string | null }>();
    for (const t of triples) {
      if (!tripleAgg.has(t.competitor_name)) tripleAgg.set(t.competitor_name, { pos: 0, neg: 0, neu: 0, snippet: null });
      const e = tripleAgg.get(t.competitor_name)!;
      if (t.sentiment === 'positive') e.pos++;
      else if (t.sentiment === 'negative') e.neg++;
      else e.neu++;
      if (!e.snippet && t.context_snippet) e.snippet = String(t.context_snippet).slice(0, 200);
    }

    const sovTotal = sov.attribute_responses ?? 0;
    attributeBlock = {
      attribute_id: attributeId,
      attribute: attributeName(attributeId),
      share_of_voice: (sov.rows || []).map((row: any) => ({
        competitor_name: row.competitor_name,
        named_in_pct_of_attribute_answers: pct(row.responses_naming, sovTotal),
        sample_size: { answers_naming: row.responses_naming },
      })),
      note: 'share_of_voice = competitors NAMED on prompts about this attribute. It is not competitor sentiment.',
      competitor_sentiment_themes: Array.from(tripleAgg.entries()).map(([name, v]) => ({
        competitor: name,
        positive_sentiment_pct: sentimentPct(v.pos, v.neg),
        example_snippet: v.snippet,
        sample_size: { positive: v.pos, negative: v.neg, neutral: v.neu },
      })),
      competitor_sentiment_note: triples.length
        ? 'Competitor sentiment is a newer signal accruing from Q3 2026 forward — treat as an early read, not a trend.'
        : 'Competitor sentiment is a newer signal accruing from Q3 2026 forward — no data for this attribute yet.',
      sample_size: { attribute_answers: sovTotal },
    };
  }

  const coverage = competitors.length === 0 && !attributeBlock
    ? coverageNoData(`No competitor mentions${r.buckets ? ` for ${r.buckets.join('/')}` : ''} across the measured periods ${r.quarters.join(', ')}.`)
    : competitors.length === 0 && attributeBlock
      ? coveragePartial('No overall competitor stats in this window; only the attribute lens returned data.')
      : coverageFound({ competitor_count: competitors.length });

  return JSON.stringify({
    competitors,
    ...(attributeBlock ? { attribute_lens: attributeBlock } : {}),
    sample_size: { answers: totalResponses },
    _coverage: coverage,
    _meta: metaFor(r, [
      'Competitor names are canonicalized; job boards/platforms and the company itself are excluded from competitor lists.',
    ]),
  });
}

// ─── get_trends ─────────────────────────────────────────────────────────────
export async function getTrends(
  ctx: ToolContext,
  companyId: string,
  metric: string,
  location: string | undefined,
  quartersBack: number,
  includeSiblings: boolean
): Promise<string> {
  const valid = ['visibility', 'sentiment', 'citations'];
  const m = (metric || 'visibility').toLowerCase();
  if (!valid.includes(m)) {
    return JSON.stringify({ error: `Unknown metric "${metric}". Valid: ${valid.join(', ')}.` });
  }

  const r = await resolveScope(ctx, companyId, { location, quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  let rollups: any;
  try { rollups = await readRollups(ctx, r); } catch (err: any) { return JSON.stringify({ error: err.message }); }

  const stats: any[] = rollups?.scope_stats || [];
  if (!stats.length) {
    return JSON.stringify({
      _coverage: coverageNoData(`No data${r.buckets ? ` for ${r.buckets.join('/')}` : ''} across the measured periods ${r.quarters.join(', ')}.`),
      _meta: metaFor(r),
    });
  }

  const quarterlyAgg = toQuarterly(stats, (row) => ({
    _total: row.total_responses || 0,
    _mentioned: row.mentioned_responses || 0,
    _pos: row.positive_themes || 0,
    _neg: row.negative_themes || 0,
    _citations: row.total_citations || 0,
  }), r.inProgressQuarter);

  const series = quarterlyAgg.map(({ quarter, _total, _mentioned, _pos, _neg, _citations }) => {
    if (m === 'visibility') {
      return { quarter, visibility_pct: pct(_mentioned, _total), sample_size: { answers: _total, answers_mentioning_company: _mentioned } };
    }
    if (m === 'sentiment') {
      return { quarter, positive_sentiment_pct: sentimentPct(_pos, _neg), sample_size: { opinionated_themes: _pos + _neg } };
    }
    return { quarter, citations_per_answer: rate1(_citations, _total), sample_size: { answers: _total, citations: _citations } };
  });

  const valueOf = (s: any): number | null =>
    m === 'visibility' ? s.visibility_pct : m === 'sentiment' ? s.positive_sentiment_pct : s.citations_per_answer;

  const methodologyNote = m === 'sentiment' ? [METHODOLOGY_NOTES.sentiment]
    : m === 'visibility' ? [METHODOLOGY_NOTES.visibility]
    : ['citations_per_answer = average number of sources cited per AI answer — a rate, so waves of different sizes compare directly.'];

  return JSON.stringify({
    metric: m,
    series,
    change: changeBlock(series.map(s => ({ quarter: s.quarter, value: valueOf(s) })), r.inProgressQuarter),
    _coverage: coverageFound({ periods: series.length }),
    _meta: metaFor(r, methodologyNote),
  });
}
