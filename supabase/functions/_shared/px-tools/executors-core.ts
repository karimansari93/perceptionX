// ─── px-tools: core executors ───────────────────────────────────────────────
// The original chat-with-data tool surface (overview, metrics, themes,
// attributes, competitors, citations, platforms, comparisons, answer texts),
// rebuilt on the dashboard cubes and SQL aggregates for the Ford pilot
// guardrail audit (2026-09-03). What changed and why:
//
//   * Windowed to MEASURED periods (default: the latest measured quarter,
//     brand scope) — the dashboard's default view — instead of pooling every
//     wave ever collected for one market profile. Pooled lifetime numbers
//     did not match the app.
//   * Aggregates come from RPCs (mcp_get_rollups, mcp_get_theme_stats,
//     mcp_get_competitor_stats, mcp_get_domain_stats). The previous raw-row
//     reads went through PostgREST, which caps at max_rows=1000, so every
//     real company's counts were silently truncated.
//   * Relevance reads company_relevance_scores_mv (the dashboard's source).
//     The old read targeted a relation that does not exist, so EPS lost its
//     20% relevance component.
//   * Percentages lead; raw counts nest under sample_size; change is in
//     percentage points vs the previous measured period.
//
// get_responses / search_responses stay as bounded raw reads (they return
// answer texts, newest first) — periods on those are bare quarter labels.

import {
  buildMeta, coverageFound, coverageNoData, coveragePartial, EXCLUDED_AI_MODELS_FILTER,
  extractSnippet, labelQuarter, METHODOLOGY_NOTES, monthToQuarter, pct, pointsDelta,
  quartersOfMonths, sentimentPct, sortQuarters, topPagesByDomain, PAGES_UNAVAILABLE_NOTE,
} from './helpers.ts';
import {
  metaFor, narrowToQuarter, resolveMeasurementPeriods, resolveScope,
} from './scope.ts';
import type { ResolvedScope, ToolContext } from './scope.ts';
import {
  attributeName, buildAttributeRows, getCompetitorLandscape, readRollups,
} from './executors-insights.ts';

// ─── Response-level sentiment (bounded reads only) ──────────────────────────
async function getResponseSentiments(
  admin: any,
  responseIds: string[]
): Promise<Map<string, { label: string; pos: number; neg: number }>> {
  if (!responseIds.length) return new Map();

  // Methodology v2: sentiment comes from the text labels only.
  const { data: themes } = await admin
    .from('ai_themes')
    .select('response_id, sentiment')
    .in('response_id', responseIds);

  const grouped = new Map<string, { pos: number; neg: number }>();
  for (const t of (themes || [])) {
    if (!grouped.has(t.response_id)) grouped.set(t.response_id, { pos: 0, neg: 0 });
    const entry = grouped.get(t.response_id)!;
    if (t.sentiment === 'positive') entry.pos++;
    else if (t.sentiment === 'negative') entry.neg++;
  }

  const result = new Map<string, { label: string; pos: number; neg: number }>();
  for (const [id, { pos, neg }] of grouped) {
    const label = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
    result.set(id, { label, pos, neg });
  }
  return result;
}

// ─── list_companies ─────────────────────────────────────────────────────────
export async function listCompanies(ctx: ToolContext): Promise<string> {
  const { admin, organizationId } = ctx;
  const { data: orgCompanies, error: orgError } = await admin
    .from('organization_companies')
    .select('company_id')
    .eq('organization_id', organizationId);

  if (orgError) return JSON.stringify({ companies: [], error: orgError.message });
  if (!orgCompanies?.length) return JSON.stringify({ companies: [], message: "No companies found in this organization." });

  const companyIds = orgCompanies.map((oc: any) => oc.company_id);

  const [companiesResult, industriesResult, periods] = await Promise.all([
    admin.from('companies').select('id, name, country').in('id', companyIds),
    admin.from('company_industries').select('company_id, industry').in('company_id', companyIds),
    resolveMeasurementPeriods(ctx, companyIds, null),
  ]);

  const industriesMap = new Map<string, Set<string>>();
  for (const r of (industriesResult.data || [])) {
    if (!industriesMap.has(r.company_id)) industriesMap.set(r.company_id, new Set());
    industriesMap.get(r.company_id)!.add(r.industry);
  }

  const companies = (companiesResult.data || []).map((c: any) => {
    const measured = periods.byCompany.get(c.id);
    const quarters = measured ? quartersOfMonths(measured.months) : [];
    const latest = quarters[quarters.length - 1] ?? null;
    return {
      id: c.id,
      name: c.name,
      country: c.country || null,
      industries: Array.from(industriesMap.get(c.id) || []),
      latest_period: latest ? labelQuarter(latest, periods.inProgressQuarter) : null,
      measured_periods: quarters.length,
      // Lifetime answer count: a size cue for picking a profile, not a metric.
      total_responses: measured?.answers ?? 0,
    };
  }).sort((a: any, b: any) => b.total_responses - a.total_responses || a.name.localeCompare(b.name));

  // Coverage: flag profiles with no measured period yet so the model says
  // "X hasn't been measured yet" plainly instead of pretending it doesn't
  // exist — and never calls a measured profile's calendar gaps "missing".
  const unmeasured = companies.filter((c: any) => c.measured_periods === 0).map((c: any) => c.name);
  const coverage = unmeasured.length === 0
    ? coverageFound({ total_companies: companies.length })
    : coveragePartial(
        `${unmeasured.length} of ${companies.length} profiles have not been measured yet`,
        { not_yet_measured: unmeasured }
      );

  const labeled = periods.quarters.map(q => labelQuarter(q, periods.inProgressQuarter));
  return JSON.stringify({
    companies,
    total: companies.length,
    _coverage: coverage,
    _meta: buildMeta({
      latest_period: labeled[labeled.length - 1] ?? null,
      period_range: labeled.length ? { from: labeled[0], to: labeled[labeled.length - 1] } : null,
      periods: labeled,
      ...(periods.inProgressQuarter ? { collection_in_progress: true } : {}),
      note: 'Same-name profiles are one brand measured per market; the market-aware tools aggregate them (include_siblings) exactly like the dashboard.',
    }),
  });
}

// ─── Scorecard from the cubes ───────────────────────────────────────────────
interface ScoredQuarter {
  quarter: string;          // bare
  label: string;            // presentation
  eps: number;
  eps_label: string;
  positive_sentiment_pct: number | null;
  visibility_pct: number | null;
  relevance_pct: number | null;
  sample_size: {
    answers: number;
    answers_mentioning_company: number;
    opinionated_themes: number;
    scored_citations: number;
  };
}

const epsLabel = (eps: number) => eps >= 80 ? 'Excellent' : eps >= 65 ? 'Good' : eps >= 50 ? 'Fair' : 'Poor';

// One scorecard per measured quarter in the window, ascending. Mirrors the
// dashboard: visibility = mentioned/total, sentiment = pos/(pos+neg),
// relevance = citation-weighted average of the relevance MV; EPS = 50/30/20.
// A quarter without opinionated themes scores sentiment as balanced (50) in
// EPS and reports positive_sentiment_pct as null.
export function scoreQuarters(rollups: any, r: ResolvedScope): ScoredQuarter[] {
  type Acc = { answers: number; mentioned: number; pos: number; neg: number; valid: number; weighted: number };
  const byQ = new Map<string, Acc>();
  const get = (q: string) => {
    if (!byQ.has(q)) byQ.set(q, { answers: 0, mentioned: 0, pos: 0, neg: 0, valid: 0, weighted: 0 });
    return byQ.get(q)!;
  };
  for (const row of (rollups?.scope_stats || [])) {
    const a = get(monthToQuarter(String(row.response_month)));
    a.answers += row.total_responses || 0;
    a.mentioned += row.mentioned_responses || 0;
    a.pos += row.positive_themes || 0;
    a.neg += row.negative_themes || 0;
  }
  for (const row of (rollups?.relevance || [])) {
    const a = get(monthToQuarter(String(row.response_month)));
    a.valid += Number(row.valid_citations) || 0;
    a.weighted += Number(row.weighted_relevance) || 0;
  }
  return sortQuarters(byQ.keys())
    .filter(q => byQ.get(q)!.answers > 0)
    .map(q => {
      const a = byQ.get(q)!;
      const sentiment = sentimentPct(a.pos, a.neg);
      const visibility = pct(a.mentioned, a.answers);
      const relevance = a.valid > 0 ? Math.round(a.weighted / a.valid) : null;
      const eps = Math.round((sentiment ?? 50) * 0.5 + (visibility ?? 0) * 0.3 + (relevance ?? 0) * 0.2);
      return {
        quarter: q,
        label: labelQuarter(q, r.inProgressQuarter),
        eps,
        eps_label: epsLabel(eps),
        positive_sentiment_pct: sentiment,
        visibility_pct: visibility,
        relevance_pct: relevance,
        sample_size: {
          answers: a.answers,
          answers_mentioning_company: a.mentioned,
          opinionated_themes: a.pos + a.neg,
          scored_citations: a.valid,
        },
      };
    });
}

function metricsPayload(r: ResolvedScope, scored: ScoredQuarter[]): Record<string, unknown> {
  const latest = scored[scored.length - 1];
  const previous = scored.length > 1 ? scored[scored.length - 2] : null;
  return {
    company: r.scope.brandName,
    period: latest.label,
    eps: latest.eps,
    eps_label: latest.eps_label,
    positive_sentiment_pct: latest.positive_sentiment_pct,
    visibility_pct: latest.visibility_pct,
    relevance_pct: latest.relevance_pct,
    change_vs_previous_period: previous ? {
      previous_period: previous.label,
      eps_points: latest.eps - previous.eps,
      sentiment_points: pointsDelta(latest.positive_sentiment_pct, previous.positive_sentiment_pct),
      visibility_points: pointsDelta(latest.visibility_pct, previous.visibility_pct),
      relevance_points: pointsDelta(latest.relevance_pct, previous.relevance_pct),
    } : null,
    sample_size: latest.sample_size,
    scope_companies: r.scope.companyIds.length,
  };
}

const SCORECARD_NOTES = [
  METHODOLOGY_NOTES.eps, METHODOLOGY_NOTES.sentiment, METHODOLOGY_NOTES.visibility, METHODOLOGY_NOTES.relevance,
];

// Latest measured quarter + the one before it (for the delta), brand scope
// by default — the dashboard's default scorecard.
async function scorecard(
  ctx: ToolContext,
  companyId: string,
  includeSiblings: boolean
): Promise<{ r: ResolvedScope; rollups: any; scored: ScoredQuarter[] } | string> {
  const r = await resolveScope(ctx, companyId, { quartersBack: 2, includeSiblings });
  if (typeof r === 'string') return r;
  let rollups: any;
  try { rollups = await readRollups(ctx, r); } catch (err: any) { return JSON.stringify({ error: err.message }); }
  const scored = scoreQuarters(rollups, r);
  if (!scored.length) {
    return JSON.stringify({
      company: r.scope.brandName,
      _coverage: coverageNoData(`No AI answer data has been collected yet for ${r.scope.brandName}.`),
      _meta: metaFor(r),
    });
  }
  return { r, rollups, scored };
}

// ─── get_company_metrics ────────────────────────────────────────────────────
export async function getCompanyMetrics(ctx: ToolContext, companyId: string, includeSiblings: boolean): Promise<string> {
  const s = await scorecard(ctx, companyId, includeSiblings);
  if (typeof s === 'string') return s;
  const latest = s.scored[s.scored.length - 1];
  return JSON.stringify({
    ...metricsPayload(s.r, s.scored),
    formula: METHODOLOGY_NOTES.eps,
    _coverage: coverageFound({ period: latest.label }),
    _meta: metaFor(narrowToQuarter(s.r, latest.quarter), SCORECARD_NOTES),
  });
}

// ─── get_company_overview ───────────────────────────────────────────────────
// The dashboard's default view in one call: scorecard for the latest
// measured quarter (with change vs the previous one), attributes by share of
// answers, top themes, competitors and sources — all from the cubes, all
// shares-first.
export async function getCompanyOverview(ctx: ToolContext, companyId: string, includeSiblings: boolean): Promise<string> {
  const s = await scorecard(ctx, companyId, includeSiblings);
  if (typeof s === 'string') return s;
  const { r, rollups, scored } = s;
  const latest = scored[scored.length - 1];
  const latestR = narrowToQuarter(r, latest.quarter);
  const answers = latest.sample_size.answers;

  const [compRes, srcRes, themeRes] = await Promise.all([
    ctx.admin.rpc('mcp_get_competitor_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: null, p_job_functions: null, p_months: latestR.months, p_limit: 5,
    }),
    ctx.admin.rpc('mcp_get_domain_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: null, p_job_functions: null, p_months: latestR.months, p_limit: 5,
    }),
    ctx.admin.rpc('mcp_get_theme_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: null, p_job_functions: null, p_months: latestR.months, p_limit: 8,
    }),
  ]);

  // Attributes: latest-quarter share of answers + change vs the previous
  // measured quarter (built over the two-quarter window).
  const attributes = buildAttributeRows(rollups, r, { withQuarterly: true }).attributes
    .map(a => {
      const q = (a.quarterly || []).find((x: any) => x.quarter === latest.label) as any;
      if (!q) return null;
      return {
        attribute_id: a.attribute_id,
        attribute: a.attribute,
        mentioned_in_pct_of_answers: q.mentioned_in_pct_of_answers,
        positive_sentiment_pct: q.positive_sentiment_pct,
        ...(a.change_vs_previous_period ? { change_vs_previous_period: a.change_vs_previous_period } : {}),
        sample_size: q.sample_size,
      };
    })
    .filter(Boolean)
    .sort((x: any, y: any) => (y.mentioned_in_pct_of_answers ?? -1) - (x.mentioned_in_pct_of_answers ?? -1))
    .slice(0, 6);

  // Theme stats come from a random sample of the period's answers (see
  // mcp_get_theme_stats) — the share is of the sampled answers.
  const themesSampled = Number(themeRes.data?.answers_sampled) || 0;
  const topThemes = ((themeRes.data?.themes as any[]) || []).map((t: any) => ({
    theme: t.theme_name,
    mentioned_in_pct_of_answers: pct(t.responses || 0, themesSampled),
    positive_sentiment_pct: sentimentPct(t.positive || 0, t.negative || 0),
    attributes: (t.attribute_ids || []).map(attributeName),
    sample_size: { answers: t.responses || 0 },
  }));

  const compAgg = new Map<string, number>();
  for (const row of ((compRes.data?.rows as any[]) || [])) {
    compAgg.set(row.competitor_name, (compAgg.get(row.competitor_name) || 0) + (row.responses_mentioning || 0));
  }
  const topCompetitors = Array.from(compAgg.entries())
    .map(([name, n]) => ({ name, named_in_pct_of_answers: pct(n, answers), sample_size: { answers_naming: n } }))
    .sort((a, b) => b.sample_size.answers_naming - a.sample_size.answers_naming)
    .slice(0, 5);

  const srcAgg = new Map<string, { citing: number; mentioned: number }>();
  for (const row of ((srcRes.data?.rows as any[]) || [])) {
    const e = srcAgg.get(row.domain) || { citing: 0, mentioned: 0 };
    e.citing += row.responses_citing || 0;
    e.mentioned += row.mentioned_responses_citing || 0;
    srcAgg.set(row.domain, e);
  }
  const topSources = Array.from(srcAgg.entries())
    .map(([domain, v]) => ({
      domain,
      cited_in_pct_of_answers: pct(v.citing, answers),
      answer_gap_pct_of_answers: pct(Math.max(0, v.citing - v.mentioned), answers),
      sample_size: { answers_citing: v.citing },
    }))
    .sort((a, b) => b.sample_size.answers_citing - a.sample_size.answers_citing)
    .slice(0, 5);

  return JSON.stringify({
    metrics: metricsPayload(r, scored),
    top_attributes: attributes,
    top_themes: topThemes,
    top_competitors: topCompetitors,
    top_sources: topSources,
    sample_size: { answers, answers_sampled_for_themes: themesSampled },
    _coverage: coverageFound({
      period: latest.label,
      has_previous_period: scored.length > 1,
      has_attributes: attributes.length > 0,
      has_themes: topThemes.length > 0,
      has_competitors: topCompetitors.length > 0,
      has_sources: topSources.length > 0,
      ...(themeRes.error ? { themes_note: 'Theme breakdown unavailable for this scope right now.' } : {}),
    }),
    _meta: metaFor(r, [...SCORECARD_NOTES, METHODOLOGY_NOTES.attribute_share, METHODOLOGY_NOTES.theme_sample]),
  });
}

// ─── compare_companies ──────────────────────────────────────────────────────
// Side-by-side scorecards for individual profiles (markets, subsidiaries),
// each at ITS OWN latest measured period — so a profile last measured in Q2
// is labeled as such rather than silently pooled with Q3 profiles.
export async function compareCompanies(ctx: ToolContext, companyIds: string[]): Promise<string> {
  const ids = companyIds.slice(0, 10);
  const { data: comps } = await ctx.admin.from('companies').select('id, name, country').in('id', ids);
  const nameOf = new Map<string, { name: string; country: string | null }>(
    (comps || []).map((c: any) => [c.id, { name: c.name, country: c.country || null }])
  );

  const results = await Promise.all(ids.map(async (id) => {
    const info = nameOf.get(id) || { name: id, country: null };
    const r = await resolveScope(ctx, id, { quartersBack: 2, includeSiblings: false });
    if (typeof r === 'string') return { company: info.name, country: info.country, measured: false };
    let rollups: any;
    try { rollups = await readRollups(ctx, r); } catch { return { company: info.name, country: info.country, measured: false }; }
    const scored = scoreQuarters(rollups, r);
    if (!scored.length) return { company: info.name, country: info.country, measured: false };
    const { scope_companies: _omit, ...payload } = metricsPayload(r, scored);
    return { ...payload, country: info.country, measured: true };
  }));

  const measured = results.filter((x: any) => x.measured);
  const missing = results.filter((x: any) => !x.measured).map((x: any) => x.company);
  const periods = Array.from(new Set(measured.map((x: any) => x.period)));

  let coverage = missing.length === 0
    ? coverageFound({ compared: measured.length })
    : coveragePartial(
        `${missing.length} of ${results.length} profiles have not been measured yet and are excluded from the comparison.`,
        { not_yet_measured: missing }
      );
  if (periods.length > 1) {
    coverage = { ...coverage, note: `Profiles were last measured in different periods (${periods.join(', ')}); each row is labeled with its own period.` };
  }

  return JSON.stringify({
    comparison: measured.map(({ measured: _m, ...row }: any) => row),
    _coverage: coverage,
    _meta: buildMeta({ periods, methodology: [METHODOLOGY_NOTES.platform_coverage, METHODOLOGY_NOTES.periods, ...SCORECARD_NOTES] }),
  });
}

// ─── get_themes ─────────────────────────────────────────────────────────────
export async function getThemes(ctx: ToolContext, companyId: string, quartersBack: number, includeSiblings: boolean): Promise<string> {
  const r = await resolveScope(ctx, companyId, { quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const [rollupsRes, themeRes] = await Promise.all([
    readRollups(ctx, r).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e })),
    ctx.admin.rpc('mcp_get_theme_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions, p_months: r.months, p_limit: 30,
    }),
  ]);
  if (rollupsRes.error) return JSON.stringify({ error: rollupsRes.error.message });
  if (themeRes.error) return JSON.stringify({ error: `Theme stats read failed: ${themeRes.error.message}` });

  const rollups = rollupsRes.data;
  const built = buildAttributeRows(rollups, r, { withQuarterly: false });
  const answers = built.totalAnswers;
  // Theme shares are of the sampled answers (mcp_get_theme_stats samples up
  // to 1,500 answers before joining their themes).
  const themesSampled = Number(themeRes.data?.answers_sampled) || 0;
  const rows: any[] = themeRes.data?.themes || [];
  if (!rows.length) {
    return JSON.stringify({
      themes: [],
      _coverage: coverageNoData(`No themes have been extracted for ${r.scope.brandName} across the measured periods ${r.quarters.join(', ')}.`),
      _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment]),
    });
  }

  const themes = rows.map((t: any) => {
    const pos = t.positive || 0, neg = t.negative || 0, neu = t.neutral || 0;
    return {
      theme: t.theme_name,
      mentioned_in_pct_of_answers: pct(t.responses || 0, themesSampled),
      positive_sentiment_pct: sentimentPct(pos, neg),
      sentiment_label: pos > neg ? 'Positive' : neg > pos ? 'Negative' : 'Mixed/Neutral',
      attributes: (t.attribute_ids || []).map(attributeName),
      platforms: t.platforms || [],
      description: t.description || null,
      sample_keywords: Array.isArray(t.keywords) ? t.keywords.slice(0, 5) : [],
      sample_size: { answers: t.responses || 0, positive: pos, negative: neg, neutral: neu },
    };
  });

  return JSON.stringify({
    themes,
    attribute_summary: built.attributes,
    sample_size: {
      answers,
      answers_sampled_for_themes: themesSampled,
      sampled_answers_with_themes: themeRes.data?.responses_with_themes || 0,
      distinct_themes_in_sample: themeRes.data?.theme_total || 0,
    },
    _coverage: coverageFound({ theme_count: themes.length, attribute_count: built.attributes.length }),
    _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment, METHODOLOGY_NOTES.attribute_share, METHODOLOGY_NOTES.theme_sample]),
  });
}

// ─── get_attribute_breakdown ────────────────────────────────────────────────
export async function getAttributeBreakdown(ctx: ToolContext, companyId: string, quartersBack: number, includeSiblings: boolean): Promise<string> {
  const r = await resolveScope(ctx, companyId, { quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const [rollupsRes, themeRes] = await Promise.all([
    readRollups(ctx, r).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e })),
    ctx.admin.rpc('mcp_get_theme_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions, p_months: r.months, p_limit: 1,
    }),
  ]);
  if (rollupsRes.error) return JSON.stringify({ error: rollupsRes.error.message });

  const built = buildAttributeRows(rollupsRes.data, r, { withQuarterly: true });
  if (!built.attributes.length) {
    return JSON.stringify({
      _coverage: coverageNoData(`No attribute themes have been extracted for ${r.scope.brandName} across the measured periods ${r.quarters.join(', ')}.`),
      _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment]),
    });
  }
  const topThemes: Record<string, string[]> = themeRes.data?.attribute_top_themes || {};
  const attributes = built.attributes.map(a => ({
    ...a,
    sentiment_label: a.sample_size.positive_themes > a.sample_size.negative_themes ? 'Positive'
      : a.sample_size.negative_themes > a.sample_size.positive_themes ? 'Negative' : 'Mixed',
    top_themes: topThemes[a.attribute_id] || [],
  }));

  return JSON.stringify({
    attributes,
    sample_size: { answers: built.totalAnswers, themes: built.allThemes },
    _coverage: coverageFound({ attribute_count: attributes.length }),
    _meta: metaFor(r, [METHODOLOGY_NOTES.sentiment, METHODOLOGY_NOTES.attribute_share]),
  });
}

// ─── get_competitors ────────────────────────────────────────────────────────
// Same cube, same shape as get_competitor_landscape without the market /
// attribute lenses.
export function getCompetitors(ctx: ToolContext, companyId: string, quartersBack: number, includeSiblings: boolean): Promise<string> {
  return getCompetitorLandscape(ctx, companyId, undefined, undefined, quartersBack, 15, includeSiblings);
}

// ─── get_citations ──────────────────────────────────────────────────────────
// Domains cited in the scope, shares-first, each with its most-cited pages
// (url + title) so a host can link a source rather than name a bare domain.
// Domain and page shares both come from cubes (complete counts, one
// denominator), so a page's share reads against its domain's.
export async function getCitations(
  ctx: ToolContext,
  companyId: string,
  domainFilter: string | undefined,
  quartersBack: number,
  includeSiblings: boolean
): Promise<string> {
  const r = await resolveScope(ctx, companyId, { quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const filter = domainFilter ? domainFilter.replace(/^www\./, '').toLowerCase().trim() : '';
  const exactDomain = filter.includes('.') ? filter : null;   // a full domain narrows the page read itself
  const [domainRes, rollupsRes, pagesRes] = await Promise.all([
    ctx.admin.rpc('mcp_get_domain_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions, p_months: r.months,
      p_limit: filter ? 500 : 60,
    }),
    readRollups(ctx, r).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e })),
    ctx.admin.rpc('mcp_get_cited_pages', {
      p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions, p_months: r.months,
      p_domain: exactDomain,
      p_limit: filter ? 100 : 90,
      p_per_domain: filter ? 10 : 3,
    }),
  ]);
  if (domainRes.error) return JSON.stringify({ error: `Domain stats read failed: ${domainRes.error.message}` });
  if (rollupsRes.error) return JSON.stringify({ error: rollupsRes.error.message });

  const answers = ((rollupsRes.data?.scope_stats || []) as any[]).reduce((s, row) => s + (row.total_responses || 0), 0);
  const byDomain = new Map<string, { citing: number; mentioned: number; citations: number }>();
  let totalCitations = 0;
  for (const row of ((domainRes.data?.rows as any[]) || [])) {
    const d = String(row.domain);
    if (filter && !d.includes(filter)) continue;
    const e = byDomain.get(d) || { citing: 0, mentioned: 0, citations: 0 };
    e.citing += row.responses_citing || 0;
    e.mentioned += row.mentioned_responses_citing || 0;
    e.citations += row.citation_count || 0;
    totalCitations += row.citation_count || 0;
    byDomain.set(d, e);
  }

  if (!byDomain.size) {
    return JSON.stringify({
      citations: [],
      _coverage: coverageNoData(
        filter
          ? `No citations from a domain matching "${domainFilter}" across the measured periods ${r.quarters.join(', ')}.`
          : `No citations have been captured for ${r.scope.brandName} across the measured periods ${r.quarters.join(', ')}.`
      ),
      _meta: metaFor(r),
    });
  }

  const pagesByDomain = pagesRes.error
    ? new Map<string, Record<string, unknown>[]>()
    : topPagesByDomain(pagesRes.data?.rows || [], answers, 'cited_in_pct_of_answers');

  const citations: any[] = Array.from(byDomain.entries())
    .map(([domain, v]) => ({
      domain,
      cited_in_pct_of_answers: pct(v.citing, answers),
      share_of_citations_pct: pct(v.citations, totalCitations),
      answer_gap_pct_of_answers: pct(Math.max(0, v.citing - v.mentioned), answers),
      top_pages: pagesByDomain.get(domain) || [],
      sample_size: { answers_citing: v.citing, citations: v.citations },
    }))
    .sort((a, b) => b.sample_size.answers_citing - a.sample_size.answers_citing)
    .slice(0, filter ? 50 : 20);

  return JSON.stringify({
    citations,
    sample_size: {
      answers,
      citations: totalCitations,
      distinct_domains: domainRes.data?.domain_total ?? byDomain.size,
    },
    _coverage: coverageFound({
      unique_domains: citations.length,
      ...(filter ? { domain_filter: domainFilter } : {}),
      ...(pagesRes.error ? { pages_note: PAGES_UNAVAILABLE_NOTE } : {}),
    }),
    _meta: metaFor(r, [
      'Domains are canonicalized (regional variants collapse to one root).',
      '"answer_gap" = answers citing this domain where the company was NOT mentioned — the outreach opportunity surface.',
      METHODOLOGY_NOTES.pages,
    ]),
  });
}

// ─── get_model_breakdown ────────────────────────────────────────────────────
export async function getModelBreakdown(ctx: ToolContext, companyId: string, quartersBack: number, includeSiblings: boolean): Promise<string> {
  const r = await resolveScope(ctx, companyId, { quartersBack, includeSiblings });
  if (typeof r === 'string') return r;

  const [rollupsRes, themeRes] = await Promise.all([
    readRollups(ctx, r).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e })),
    ctx.admin.rpc('mcp_get_theme_stats', {
      p_company_ids: r.scope.companyIds, p_buckets: r.buckets, p_job_functions: r.jobFunctions, p_months: r.months, p_limit: 1,
    }),
  ]);
  if (rollupsRes.error) return JSON.stringify({ error: rollupsRes.error.message });

  const byModel = new Map<string, { answers: number; mentioned: number; withThemes: number; pos: number; neg: number; neu: number }>();
  const get = (k: string) => {
    if (!byModel.has(k)) byModel.set(k, { answers: 0, mentioned: 0, withThemes: 0, pos: 0, neg: 0, neu: 0 });
    return byModel.get(k)!;
  };
  for (const row of (rollupsRes.data?.llm_stats || [])) {
    const e = get(row.ai_model || 'unknown');
    e.answers += row.total_responses || 0;
    e.mentioned += row.mentions || 0;
  }
  for (const row of ((themeRes.data?.by_platform as any[]) || [])) {
    const e = get(row.ai_model || 'unknown');
    e.withThemes += row.responses_with_themes || 0;
    e.pos += row.positive || 0;
    e.neg += row.negative || 0;
    e.neu += row.neutral || 0;
  }
  if (!byModel.size) {
    return JSON.stringify({
      _coverage: coverageNoData(`No AI answer data has been collected yet for ${r.scope.brandName} across the measured periods ${r.quarters.join(', ')}.`),
      _meta: metaFor(r),
    });
  }

  const breakdown = Array.from(byModel.entries()).map(([platform, v]) => ({
    platform,
    visibility_pct: pct(v.mentioned, v.answers),
    positive_sentiment_pct: sentimentPct(v.pos, v.neg),
    dominant_sentiment: v.pos > v.neg ? 'Positive' : v.neg > v.pos ? 'Negative' : 'Neutral',
    sample_size: {
      answers: v.answers,
      answers_mentioning_company: v.mentioned,
      answers_with_themes: v.withThemes,
      positive_themes: v.pos, negative_themes: v.neg, neutral_themes: v.neu,
    },
  })).sort((a, b) => b.sample_size.answers - a.sample_size.answers);

  return JSON.stringify({
    model_breakdown: breakdown,
    sample_size: { answers_sampled_for_sentiment: Number(themeRes.data?.answers_sampled) || 0 },
    _coverage: coverageFound({
      platform_count: breakdown.length,
      ...(themeRes.error ? { sentiment_note: 'Per-platform sentiment unavailable for this scope right now; visibility is complete.' } : {}),
    }),
    _meta: metaFor(r, [METHODOLOGY_NOTES.visibility, METHODOLOGY_NOTES.sentiment, METHODOLOGY_NOTES.theme_sample]),
  });
}

// ─── get_responses / search_responses (bounded raw reads) ───────────────────
export async function getResponses(
  ctx: ToolContext,
  companyId: string,
  limit?: number,
  promptType?: string,
  aiModel?: string,
  sentimentFilter?: string
): Promise<string> {
  const { admin } = ctx;
  const maxLimit = Math.min(limit || 15, 50);

  let query = admin
    .from('prompt_responses')
    .select(`
      id, ai_model, response_text,
      company_mentioned, detected_competitors, tested_at, response_month,
      confirmed_prompts(prompt_text, prompt_category, prompt_type)
    `)
    .eq('company_id', companyId)
    .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
    .order('tested_at', { ascending: false })
    .limit(promptType || aiModel || sentimentFilter ? maxLimit * 4 : maxLimit);

  if (aiModel) query = query.ilike('ai_model', `%${aiModel}%`);

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });

  let filtered = data || [];
  if (promptType) {
    filtered = filtered.filter((r: any) => r.confirmed_prompts?.prompt_type === promptType);
  }

  const responseIds = filtered.map((r: any) => r.id);
  const sentimentMap = await getResponseSentiments(admin, responseIds);

  if (sentimentFilter) {
    filtered = filtered.filter((r: any) => {
      const s = sentimentMap.get(r.id);
      return s ? s.label === sentimentFilter : sentimentFilter === 'neutral';
    });
  }

  filtered = filtered.slice(0, maxLimit);

  const responses = filtered.map((r: any) => {
    const s = sentimentMap.get(r.id);
    // Response minimization (plugin guidelines): no internal ids or raw
    // timestamps in the payload — the client-facing period grain is quarters.
    const month = r.response_month || r.tested_at;
    return {
      ai_model: r.ai_model,
      prompt: r.confirmed_prompts?.prompt_text,
      prompt_type: r.confirmed_prompts?.prompt_type,
      response_text: r.response_text?.length > 1000
        ? r.response_text.substring(0, 1000) + '... [truncated]'
        : r.response_text,
      sentiment: s?.label || null,
      company_mentioned: r.company_mentioned,
      competitors_mentioned: r.detected_competitors,
      period: month ? monthToQuarter(String(month)) : null,
    };
  });

  const coverage = responses.length === 0
    ? coverageNoData(
        `No answers found` +
        (promptType ? ` for prompt_type "${promptType}"` : '') +
        (aiModel ? ` from ai_model "${aiModel}"` : '') +
        (sentimentFilter ? ` with sentiment "${sentimentFilter}"` : '') + '.'
      )
    : coverageFound({
        returned: responses.length,
        order: 'newest first',
        filters_applied: {
          prompt_type: promptType || null,
          ai_model: aiModel || null,
          sentiment: sentimentFilter || null,
        },
      });

  return JSON.stringify({ total_returned: responses.length, responses, _coverage: coverage });
}

export async function searchResponses(ctx: ToolContext, companyId: string, keyword: string, limit?: number): Promise<string> {
  const { admin } = ctx;
  const maxLimit = Math.min(limit || 10, 30);

  const { data, error } = await admin
    .from('prompt_responses')
    .select(`
      id, ai_model, response_text, tested_at, response_month,
      confirmed_prompts(prompt_text, prompt_type)
    `)
    .eq('company_id', companyId)
    .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
    .ilike('response_text', `%${keyword}%`)
    .order('tested_at', { ascending: false })
    .limit(maxLimit);

  if (error) return JSON.stringify({ error: error.message });

  const responseIds = (data || []).map((r: any) => r.id);
  const sentimentMap = await getResponseSentiments(admin, responseIds);

  const results = (data || []).map((r: any) => {
    const month = r.response_month || r.tested_at;
    return {
      ai_model: r.ai_model,
      prompt: r.confirmed_prompts?.prompt_text,
      prompt_type: r.confirmed_prompts?.prompt_type,
      sentiment: sentimentMap.get(r.id)?.label || null,
      snippet: extractSnippet(r.response_text || '', keyword, 300),
      period: month ? monthToQuarter(String(month)) : null,
    };
  });

  const coverage = results.length === 0
    ? coverageNoData(`No AI answers for this company mention "${keyword}".`)
    : coverageFound({ matches: results.length, keyword, order: 'newest first' });
  return JSON.stringify({ keyword, results_found: results.length, results, _coverage: coverage });
}
