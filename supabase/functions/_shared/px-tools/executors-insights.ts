// ─── px-tools: insight executors ────────────────────────────────────────────
// The location/attribute-aware tools built for the MCP surface ("what's our
// culture like in India?"). They read the SAME stats cubes the dashboard
// reads (via service-role twin RPCs), so chat/MCP numbers match the app —
// never re-derived from raw tables.
//
// Presentation rules (client feedback + ChatGPT plugin guidelines):
//   * Periods are QUARTERS. Internal storage is monthly, but payloads never
//     expose raw dates or timestamps — the running quarter is labeled
//     "(in progress)" so a light last data point isn't misread as a decline.
//   * Percentages, not decimals — "81", never "0.81".
//   * Say what's INCLUDED (tracked platforms), never what's excluded.
//   * Response minimization: no internal ids, timestamps, or diagnostics.
//
// Every result is self-caveating: `_coverage` plus `_meta` carrying the
// period range, matched market spellings, scope size, and methodology notes.
// Over MCP the host model never sees our system prompt, so the payload is
// the only place honesty can live.

import {
  buildMeta, coverageFound, coverageNoData, coveragePartial, currentQuarter,
  EXCLUDED_AI_MODELS_FILTER, lastQuarterMonths, METHODOLOGY_NOTES,
  monthToQuarter, pct, quarterLabel, quarterSortKey, sentimentPct,
} from './helpers.ts';
import {
  resolveBrandScope, resolveLocationBuckets,
} from './scope.ts';
import type { ToolContext, BrandScope } from './scope.ts';

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

// Common phrasings → attribute id, so a host model's first call lands
// ("who's our top competitor for pay?" → compensation) instead of costing a
// visible retry round-trip. Kept small and unambiguous.
const ATTRIBUTE_ALIASES: Record<string, string> = {
  'pay': 'compensation', 'salary': 'compensation', 'salaries': 'compensation',
  'benefits': 'compensation', 'perks': 'compensation', 'comp': 'compensation',
  'culture': 'company-culture', 'work culture': 'company-culture',
  'work-life balance': 'wellbeing-balance', 'work life balance': 'wellbeing-balance',
  'wellbeing': 'wellbeing-balance', 'wellness': 'wellbeing-balance', 'balance': 'wellbeing-balance',
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

interface ResolvedScope {
  scope: BrandScope;
  buckets: string[] | null;      // null = no location filter
  available: string[];
  months: string[];              // internal cube filter (never emitted)
  quartersBack: number;
}

// Common preamble for every insight tool: brand scope + optional location
// match + quarter window. Returns an error string (already JSON) on failure.
async function resolveScopeAndLocation(
  ctx: ToolContext,
  companyId: string,
  location: string | undefined,
  quartersBack: number,
  includeSiblings: boolean
): Promise<ResolvedScope | string> {
  const scope = await resolveBrandScope(ctx, companyId, includeSiblings);
  if ('error' in scope) return JSON.stringify({ error: scope.error });

  let buckets: string[] | null = null;
  let available: string[] = [];
  if (location && location.trim()) {
    const match = await resolveLocationBuckets(ctx, scope.companyIds, location);
    available = match.available;
    if (!match.buckets.length) {
      return JSON.stringify({
        _coverage: coverageNoData(
          `No tracked market matches "${location}" for ${scope.brandName}. Answer from the available markets or tell the user this market isn't covered yet.`,
          { available_markets: available }
        ),
      });
    }
    buckets = match.buckets;
  }
  return { scope, buckets, available, months: lastQuarterMonths(quartersBack), quartersBack };
}

function metaFor(r: ResolvedScope, extraNotes: string[] = []) {
  return buildMeta({
    period_range: {
      from: monthToQuarter(r.months[0]),
      to: quarterLabel(monthToQuarter(r.months[r.months.length - 1])),
    },
    scope_companies: r.scope.companyIds.length,
    scope_brand: r.scope.brandName,
    locations_matched: r.buckets ?? undefined,
    methodology: [METHODOLOGY_NOTES.platform_coverage, ...extraNotes],
  });
}

// Roll monthly cube rows into an ordered quarterly series. `pick` extracts
// the numeric fields to sum from each row.
function toQuarterly<T extends Record<string, number>>(
  rows: any[],
  pick: (row: any) => T
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
    .map(([quarter, vals]) => ({ quarter: quarterLabel(quarter), ...vals }));
}

// ─── get_attribute_themes ───────────────────────────────────────────────────
// "What's our culture like in India?" — attribute × market sentiment from
// the dashboard cube, quarterly, plus real theme quotes when a single
// attribute is in focus.
export async function getAttributeThemes(
  ctx: ToolContext,
  companyId: string,
  attributeInput: string | undefined,
  location: string | undefined,
  quartersBack: number,
  includeSiblings: boolean
): Promise<string> {
  const attributeId = attributeInput ? resolveAttributeId(attributeInput) : null;
  if (attributeInput && !attributeId) {
    return JSON.stringify({
      error: `Unknown attribute "${attributeInput}". Valid attribute ids: ${ATTRIBUTE_IDS_HELP}.`,
    });
  }

  const r = await resolveScopeAndLocation(ctx, companyId, location, quartersBack, includeSiblings);
  if (typeof r === 'string') return r;

  const { data: rollups, error } = await ctx.admin.rpc('mcp_get_rollups', {
    p_company_ids: r.scope.companyIds,
    p_buckets: r.buckets,
    p_months: r.months,
  });
  if (error) return JSON.stringify({ error: `Rollup read failed: ${error.message}` });

  const rows: any[] = (rollups?.attribute_themes || []).filter(
    (row: any) => !attributeId || row.attribute_id === attributeId
  );

  if (!rows.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No theme data for ${attributeId ?? 'any attribute'}${r.buckets ? ` in ${r.buckets.join('/')}` : ''} in the last ${r.quartersBack} quarters.`,
        r.available.length ? { available_markets: r.available } : {}
      ),
      _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment]),
    });
  }

  // Aggregate: per attribute totals + quarterly series.
  const byAttr = new Map<string, { total: number; pos: number; neg: number; neu: number; rows: any[] }>();
  for (const row of rows) {
    const id = row.attribute_id || 'unknown';
    if (!byAttr.has(id)) byAttr.set(id, { total: 0, pos: 0, neg: 0, neu: 0, rows: [] });
    const a = byAttr.get(id)!;
    a.total += row.total_themes || 0;
    a.pos += row.positive_themes || 0;
    a.neg += row.negative_themes || 0;
    a.neu += row.neutral_themes || 0;
    a.rows.push(row);
  }

  const nameOf = (id: string) => ATTRIBUTES_V2.find(a => a.id === id)?.name || id;
  const allThemes = Array.from(byAttr.values()).reduce((sum, a) => sum + a.total, 0);
  const attributes = Array.from(byAttr.entries()).map(([id, a]) => ({
    attribute_id: id,
    attribute: nameOf(id),
    positive_sentiment_pct: sentimentPct(a.pos, a.neg),
    share_of_themes_pct: pct(a.total, allThemes),
    total_themes: a.total,
    positive_themes: a.pos,
    negative_themes: a.neg,
    neutral_themes: a.neu,
    quarterly: toQuarterly(a.rows, (row) => ({
      total_themes: row.total_themes || 0,
      _pos: row.positive_themes || 0,
      _neg: row.negative_themes || 0,
    })).map(({ quarter, total_themes, _pos, _neg }) => ({
      quarter, total_themes, positive_sentiment_pct: sentimentPct(_pos, _neg),
    })),
  })).sort((x, y) => y.total_themes - x.total_themes);

  // Real quotes when a single attribute is in focus — the "what are people
  // actually saying" half of the answer. Bounded, newest first, location-
  // filtered through the prompt join. No ids or dates in the payload.
  let quotes: any[] = [];
  if (attributeId) {
    let q = ctx.admin
      .from('ai_themes')
      .select('theme_name, sentiment, context_snippets, keywords, created_at, prompt_responses!inner(ai_model, confirmed_prompts!inner(location_context))')
      .in('company_id', r.scope.companyIds)
      .eq('attribute_id', attributeId)
      .not('prompt_responses.ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
      .order('created_at', { ascending: false })
      .limit(40);
    if (r.buckets) q = q.in('prompt_responses.confirmed_prompts.location_context', r.buckets);
    const { data: themeRows } = await q;
    const seen = new Set<string>();
    for (const t of (themeRows || [])) {
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
  }

  return JSON.stringify({
    attributes,
    ...(attributeId ? { focus_attribute: attributeId, example_themes: quotes } : {}),
    _coverage: coverageFound({
      attribute_count: attributes.length,
      total_themes: attributes.reduce((s, a) => s + a.total_themes, 0),
    }),
    _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment]),
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
  const r = await resolveScopeAndLocation(ctx, companyId, location, quartersBack, includeSiblings);
  if (typeof r === 'string') return r;

  const { data: rollups, error } = await ctx.admin.rpc('mcp_get_rollups', {
    p_company_ids: r.scope.companyIds,
    p_buckets: r.buckets,
    p_months: r.months,
  });
  if (error) return JSON.stringify({ error: `Rollup read failed: ${error.message}` });

  const stats: any[] = rollups?.scope_stats || [];
  if (!stats.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No response data${r.buckets ? ` for ${r.buckets.join('/')}` : ''} in the last ${r.quartersBack} quarters.`,
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
  })).map(({ quarter, _total, _mentioned }) => ({
    quarter, total_responses: _total, mentioned: _mentioned, visibility_pct: pct(_mentioned, _total),
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
      .map(([platform, v]) => ({ platform, total_responses: v.total, mentioned: v.mentioned, visibility_pct: pct(v.mentioned, v.total) }))
      .sort((a, b) => (b.total_responses - a.total_responses));
  }

  return JSON.stringify({
    visibility_pct: pct(mentioned, total),
    total_responses: total,
    mentioned_responses: mentioned,
    quarterly,
    ...(platforms ? { by_platform: platforms } : {}),
    _coverage: coverageFound({ quarters_with_data: quarterly.length }),
    _meta: metaFor(r, [METHODOLOGY_NOTES.visibility]),
  });
}

// ─── get_sources ────────────────────────────────────────────────────────────
// Canonical citation domains for the scope, with the "answer gap" measure:
// responses citing the domain where the company was NOT mentioned — the
// outreach surface ("sources talking about your space without you").
export async function getSources(
  ctx: ToolContext,
  companyId: string,
  location: string | undefined,
  quartersBack: number,
  gapOnly: boolean,
  limit: number,
  includeSiblings: boolean
): Promise<string> {
  const r = await resolveScopeAndLocation(ctx, companyId, location, quartersBack, includeSiblings);
  if (typeof r === 'string') return r;

  const [domainRes, rollupsRes] = await Promise.all([
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
  ]);
  const { data, error } = domainRes;
  if (error) return JSON.stringify({ error: `Domain stats read failed: ${error.message}` });
  const totalResponses = ((rollupsRes.data?.scope_stats || []) as any[])
    .reduce((sum, row) => sum + (row.total_responses || 0), 0);

  const rows: any[] = data?.rows || [];
  if (!rows.length) {
    return JSON.stringify({
      _coverage: coverageNoData(
        `No citation data${r.buckets ? ` for ${r.buckets.join('/')}` : ''} in the last ${r.quartersBack} quarters.`,
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

  // Shares lead, raw counts trail (presentation rule: "cited by 31% of
  // answers" is the useful stat; counts stay only as sample-size context).
  let sources = Array.from(byDomain.entries()).map(([domain, v]) => {
    const gap = Math.max(0, v.citing - v.mentionedCiting);
    return {
      domain,
      cited_in_pct_of_answers: pct(v.citing, totalResponses),
      gap_rate_pct: pct(gap, v.citing),      // of its citing answers, % where company absent
      answer_gap: gap,                       // cited while the company was absent
      responses_citing: v.citing,
      cited_and_company_mentioned: v.mentionedCiting,
      citation_count: v.citations,
    };
  });

  sources = gapOnly
    ? sources.filter(s => s.answer_gap > 0).sort((a, b) => b.answer_gap - a.answer_gap)
    : sources.sort((a, b) => b.responses_citing - a.responses_citing);
  sources = sources.slice(0, limit);

  return JSON.stringify({
    sources,
    total_answers_in_window: totalResponses,
    distinct_domains_in_window: data?.domain_total ?? byDomain.size,
    _coverage: coverageFound({ returned: sources.length, gap_only: gapOnly }),
    _meta: metaFor(r, [
      'Domains are canonicalized (regional variants collapse to one root).',
      '"answer_gap" = responses citing this domain where the company was NOT mentioned — the outreach opportunity surface.',
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
  if (attributeInput && !attributeId) {
    return JSON.stringify({
      error: `Unknown attribute "${attributeInput}". Valid attribute ids: ${ATTRIBUTE_IDS_HELP}.`,
    });
  }

  const r = await resolveScopeAndLocation(ctx, companyId, location, quartersBack, includeSiblings);
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
    responses_mentioning: v.responses,
    co_mentioned_with_company: v.coMentions,
    by_prompt_type: Object.fromEntries(v.byType),
  })).sort((a, b) => b.responses_mentioning - a.responses_mentioning).slice(0, limit);

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
      share_of_voice: (sov.rows || []).map((row: any) => ({
        competitor_name: row.competitor_name,
        named_in_pct_of_attribute_answers: pct(row.responses_naming, sovTotal),
        responses_naming: row.responses_naming,
      })),
      attribute_responses_analyzed: sovTotal,
      note: 'share_of_voice = competitors NAMED on prompts about this attribute. It is not competitor sentiment.',
      competitor_sentiment_themes: Array.from(tripleAgg.entries()).map(([name, v]) => ({
        competitor: name, positive: v.pos, negative: v.neg, neutral: v.neu, example_snippet: v.snippet,
      })),
      competitor_sentiment_note: triples.length
        ? 'Competitor sentiment is a newer signal accruing from Q3 2026 forward — treat as an early read, not a trend.'
        : 'Competitor sentiment is a newer signal accruing from Q3 2026 forward — no data for this attribute yet.',
    };
  }

  const coverage = competitors.length === 0 && !attributeBlock
    ? coverageNoData(`No competitor mentions${r.buckets ? ` for ${r.buckets.join('/')}` : ''} in the last ${r.quartersBack} quarters.`)
    : competitors.length === 0 && attributeBlock
      ? coveragePartial('No overall competitor stats in this window; only the attribute lens returned data.')
      : coverageFound({ competitor_count: competitors.length });

  return JSON.stringify({
    competitors,
    ...(attributeBlock ? { attribute_lens: attributeBlock } : {}),
    total_responses_in_window: totalResponses,
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

  const r = await resolveScopeAndLocation(ctx, companyId, location, quartersBack, includeSiblings);
  if (typeof r === 'string') return r;

  const { data: rollups, error } = await ctx.admin.rpc('mcp_get_rollups', {
    p_company_ids: r.scope.companyIds,
    p_buckets: r.buckets,
    p_months: r.months,
  });
  if (error) return JSON.stringify({ error: `Rollup read failed: ${error.message}` });

  const stats: any[] = rollups?.scope_stats || [];
  if (!stats.length) {
    return JSON.stringify({
      _coverage: coverageNoData(`No data${r.buckets ? ` for ${r.buckets.join('/')}` : ''} in the last ${r.quartersBack} quarters.`),
      _meta: metaFor(r),
    });
  }

  const quarterlyAgg = toQuarterly(stats, (row) => ({
    _total: row.total_responses || 0,
    _mentioned: row.mentioned_responses || 0,
    _pos: row.positive_themes || 0,
    _neg: row.negative_themes || 0,
    _citations: row.total_citations || 0,
  }));

  const series = quarterlyAgg.map(({ quarter, _total, _mentioned, _pos, _neg, _citations }) => {
    if (m === 'visibility') return { quarter, visibility_pct: pct(_mentioned, _total), total_responses: _total };
    if (m === 'sentiment') return { quarter, positive_sentiment_pct: sentimentPct(_pos, _neg), opinionated_themes: _pos + _neg };
    return { quarter, total_citations: _citations };
  });

  const valueOf = (s: any) => m === 'visibility' ? s.visibility_pct : m === 'sentiment' ? s.positive_sentiment_pct : s.total_citations;
  const values = series.map(valueOf).filter((v): v is number => v !== null && v !== undefined);
  const first = values[0] ?? null;
  const last = values[values.length - 1] ?? null;

  const methodologyNote = m === 'sentiment' ? [METHODOLOGY_NOTES.sentiment]
    : m === 'visibility' ? [METHODOLOGY_NOTES.visibility] : [];

  return JSON.stringify({
    metric: m,
    series,
    change: first !== null && last !== null
      ? { first, latest: last, delta: last - first, note: `The latest quarter (${quarterLabel(currentQuarter())}) may still be filling in.` }
      : null,
    _coverage: coverageFound({ quarters_with_data: series.length }),
    _meta: metaFor(r, methodologyNote),
  });
}
