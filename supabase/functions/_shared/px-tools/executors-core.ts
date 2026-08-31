// ─── px-tools: core executors ───────────────────────────────────────────────
// The original chat-with-data tool implementations, moved verbatim onto the
// shared ToolContext so the MCP server runs the identical logic. Behavior
// changes kept to exactly one: list_companies read countries from the dropped
// user_onboarding table (silently yielding null); it now reads
// companies.country.

import {
  coverageFound, coverageNoData, coveragePartial,
  EXCLUDED_AI_MODELS_FILTER, extractSnippet,
  monthToQuarter, quarterLabel, sentimentPct,
} from './helpers.ts';
import type { ToolContext } from './scope.ts';

async function getResponseSentiments(
  admin: any,
  responseIds: string[]
): Promise<Map<string, { label: string; score: number | null; pos: number; neg: number }>> {
  if (!responseIds.length) return new Map();

  // Methodology v2: sentiment comes from the text labels only —
  // score = positive/(positive+negative), null when no polarized themes.
  const { data: themes } = await admin
    .from('ai_themes')
    .select('response_id, sentiment')
    .in('response_id', responseIds);

  const grouped = new Map<string, { sentiments: string[] }>();
  for (const t of (themes || [])) {
    if (!grouped.has(t.response_id)) grouped.set(t.response_id, { sentiments: [] });
    const entry = grouped.get(t.response_id)!;
    if (t.sentiment) entry.sentiments.push(t.sentiment);
  }

  const result = new Map<string, { label: string; score: number | null; pos: number; neg: number }>();
  for (const [id, data] of grouped) {
    const pos = data.sentiments.filter(s => s === 'positive').length;
    const neg = data.sentiments.filter(s => s === 'negative').length;
    const score = (pos + neg) > 0 ? Math.round((pos / (pos + neg)) * 100) / 100 : null;
    const label = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
    result.set(id, { label, score, pos, neg });
  }

  return result;
}

export async function listCompanies(ctx: ToolContext): Promise<string> {
  const { admin, organizationId } = ctx;
  const { data: orgCompanies, error: orgError } = await admin
    .from('organization_companies')
    .select('company_id')
    .eq('organization_id', organizationId);

  if (orgError) return JSON.stringify({ companies: [], error: orgError.message });
  if (!orgCompanies?.length) return JSON.stringify({ companies: [], message: "No companies found in this organization." });

  const companyIds = orgCompanies.map((oc: any) => oc.company_id);

  const [companiesResult, industriesResult, responseCounts] = await Promise.all([
    admin.from('companies').select('id, name, country').in('id', companyIds),
    admin.from('company_industries').select('company_id, industry').in('company_id', companyIds),
    admin.from('prompt_responses').select('company_id').in('company_id', companyIds).not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER),
  ]);

  const industriesMap = new Map<string, Set<string>>();
  for (const r of (industriesResult.data || [])) {
    if (!industriesMap.has(r.company_id)) industriesMap.set(r.company_id, new Set());
    industriesMap.get(r.company_id)!.add(r.industry);
  }

  const countMap = new Map<string, number>();
  for (const r of (responseCounts.data || [])) {
    countMap.set(r.company_id, (countMap.get(r.company_id) || 0) + 1);
  }

  const companies = (companiesResult.data || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    country: c.country || null,
    industries: Array.from(industriesMap.get(c.id) || []),
    total_responses: countMap.get(c.id) || 0,
  }));

  // Coverage: flag which companies have no AI response data yet so the
  // model can tell the user "we haven't collected data for X" plainly
  // instead of silently pretending the company doesn't exist.
  const emptyCompanies = companies.filter((c: any) => c.total_responses === 0).map((c: any) => c.name);
  const coverage = emptyCompanies.length === 0
    ? coverageFound({ total_companies: companies.length })
    : coveragePartial(
        `${emptyCompanies.length} of ${companies.length} companies have no response data yet`,
        { empty_companies: emptyCompanies }
      );

  return JSON.stringify({ companies, total: companies.length, _coverage: coverage });
}

export async function computeMetrics(admin: any, companyId: string) {
  const [responsesResult, themesResult, relevanceResult, companyResult] = await Promise.all([
    admin
      .from('prompt_responses')
      .select('id, company_mentioned')
      .eq('company_id', companyId)
      .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER),
    admin
      .from('ai_themes')
      .select('sentiment, theme_name, prompt_responses!inner(ai_model)')
      .eq('company_id', companyId)
      .not('prompt_responses.ai_model', 'in', EXCLUDED_AI_MODELS_FILTER),
    admin.from('company_relevance_scores').select('relevance_score').eq('company_id', companyId).maybeSingle(),
    admin.from('companies').select('name').eq('id', companyId).single(),
  ]);

  const responses = responsesResult.data || [];
  const themes = themesResult.data || [];
  const totalResponses = responses.length;

  if (totalResponses === 0) {
    return { company: companyResult.data?.name, companyId, noData: true };
  }

  // Methodology v2: positive/(positive+negative) from the theme text labels;
  // neutrals are excluded from the score.
  const positiveThemes = themes.filter((t: any) => t.sentiment === 'positive').length;
  const negativeThemes = themes.filter((t: any) => t.sentiment === 'negative').length;
  const polarized = positiveThemes + negativeThemes;
  const sentimentScore = polarized > 0 ? positiveThemes / polarized : 0.5;
  const sentimentPctValue = Math.round(sentimentScore * 100);
  const sentimentLabel = sentimentScore > 0.6 ? 'Positive' : sentimentScore < 0.4 ? 'Negative' : 'Neutral';

  const mentioned = responses.filter((r: any) => r.company_mentioned).length;
  const visibilityPct = Math.round((mentioned / totalResponses) * 100);
  const relevancePct = Math.round(relevanceResult.data?.relevance_score || 0);

  const eps = Math.round(sentimentPctValue * 0.5 + visibilityPct * 0.3 + relevancePct * 0.2);
  const epsLabel = eps >= 80 ? 'Excellent' : eps >= 65 ? 'Good' : eps >= 50 ? 'Fair' : 'Poor';

  return {
    company: companyResult.data?.name,
    companyId,
    eps,
    eps_label: epsLabel,
    sentiment: { score: sentimentPctValue, label: sentimentLabel, positive_themes: positiveThemes, negative_themes: negativeThemes, total_themes: themes.length },
    visibility: visibilityPct,
    relevance: relevancePct,
    total_responses: totalResponses,
    mentioned_count: mentioned,
  };
}

export async function getCompanyMetrics(ctx: ToolContext, companyId: string): Promise<string> {
  const metrics = await computeMetrics(ctx.admin, companyId);
  if (metrics.noData) {
    return JSON.stringify({
      company: metrics.company,
      _coverage: coverageNoData(`No AI response data has been collected yet for ${metrics.company}.`),
    });
  }
  return JSON.stringify({
    ...metrics,
    formula: "EPS = 50% sentiment + 30% visibility + 20% relevance",
    _coverage: coverageFound({ total_responses: metrics.total_responses }),
  });
}

export async function getCompanyOverview(ctx: ToolContext, companyId: string): Promise<string> {
  const [metricsData, themesData, competitorsData, citationsData] = await Promise.all([
    computeMetrics(ctx.admin, companyId),
    getThemes(ctx, companyId),
    getCompetitors(ctx, companyId),
    getCitations(ctx, companyId, false),
  ]);

  const themes = JSON.parse(themesData);
  const competitors = JSON.parse(competitorsData);
  const citations = JSON.parse(citationsData);

  // Per-section coverage rolled up so the model knows at a glance which
  // slices of the overview have data and which don't.
  const coverage = coverageFound({
    has_metrics: !metricsData.noData,
    has_themes: (themes.themes?.length || 0) > 0,
    has_competitors: (competitors.competitors?.length || 0) > 0,
    has_citations: (citations.citations?.length || 0) > 0,
  });
  if (metricsData.noData) {
    return JSON.stringify({
      company: metricsData.company,
      _coverage: coverageNoData(`No AI response data has been collected yet for ${metricsData.company}.`),
    });
  }

  return JSON.stringify({
    metrics: metricsData,
    top_themes: themes.themes?.slice(0, 8) || [],
    top_competitors: competitors.competitors?.slice(0, 5) || [],
    top_citations: citations.citations?.slice(0, 5) || [],
    _coverage: coverage,
  });
}

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
      company_mentioned, detected_competitors, tested_at,
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
      period: r.tested_at ? quarterLabel(monthToQuarter(String(r.tested_at))) : null,
    };
  });

  const coverage = responses.length === 0
    ? coverageNoData(
        `No responses found` +
        (promptType ? ` for prompt_type "${promptType}"` : '') +
        (aiModel ? ` from ai_model "${aiModel}"` : '') +
        (sentimentFilter ? ` with sentiment "${sentimentFilter}"` : '') + '.'
      )
    : coverageFound({
        returned: responses.length,
        filters_applied: {
          prompt_type: promptType || null,
          ai_model: aiModel || null,
          sentiment: sentimentFilter || null,
        },
      });

  return JSON.stringify({ total_returned: responses.length, responses, _coverage: coverage });
}

export async function getThemes(ctx: ToolContext, companyId: string): Promise<string> {
  const { admin } = ctx;
  const { data, error } = await admin
    .from('ai_themes')
    .select('theme_name, theme_description, sentiment, attribute_name, confidence_score, keywords, prompt_responses!inner(ai_model)')
    .eq('company_id', companyId)
    .not('prompt_responses.ai_model', 'in', EXCLUDED_AI_MODELS_FILTER);

  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({
    themes: [],
    _coverage: coverageNoData("No themes have been extracted for this company yet."),
  });

  const themeMap = new Map<string, {
    occurrences: number;
    sentiment_counts: { positive: number; negative: number; neutral: number };
    attributes: Set<string>;
    descriptions: string[];
    keywords: Set<string>;
  }>();

  for (const t of data) {
    const key = t.theme_name;
    if (!themeMap.has(key)) {
      themeMap.set(key, { occurrences: 0, sentiment_counts: { positive: 0, negative: 0, neutral: 0 }, attributes: new Set(), descriptions: [], keywords: new Set() });
    }
    const entry = themeMap.get(key)!;
    entry.occurrences++;
    if (t.sentiment) entry.sentiment_counts[t.sentiment as 'positive' | 'negative' | 'neutral']++;
    if (t.attribute_name) entry.attributes.add(t.attribute_name);
    if (t.theme_description && entry.descriptions.length < 2) entry.descriptions.push(t.theme_description);
    if (t.keywords?.length) t.keywords.slice(0, 3).forEach((k: string) => entry.keywords.add(k));
  }

  const themes = Array.from(themeMap.entries())
    .map(([theme_name, stats]) => {
      // Methodology v2: share of opinionated themes that are positive, as a
      // whole percentage ("81", never "0.81"); null = no opinionated signal.
      return {
        theme: theme_name,
        mentions: stats.occurrences,
        positive_sentiment_pct: sentimentPct(stats.sentiment_counts.positive, stats.sentiment_counts.negative),
        sentiment_label: stats.sentiment_counts.positive > stats.sentiment_counts.negative ? 'Positive' :
          stats.sentiment_counts.negative > stats.sentiment_counts.positive ? 'Negative' : 'Mixed/Neutral',
        sentiment_breakdown: stats.sentiment_counts,
        attributes: Array.from(stats.attributes),
        description: stats.descriptions[0] || null,
        sample_keywords: Array.from(stats.keywords).slice(0, 5),
      };
    })
    .sort((a, b) => b.mentions - a.mentions);

  const attrMap = new Map<string, { positive: number; negative: number; neutral: number; count: number }>();
  for (const t of data) {
    if (!t.attribute_name) continue;
    if (!attrMap.has(t.attribute_name)) attrMap.set(t.attribute_name, { positive: 0, negative: 0, neutral: 0, count: 0 });
    const entry = attrMap.get(t.attribute_name)!;
    entry.count++;
    if (t.sentiment) entry[t.sentiment as 'positive' | 'negative' | 'neutral']++;
  }

  const attribute_summary = Array.from(attrMap.entries())
    .map(([attr, counts]) => ({
      attribute: attr,
      total_themes: counts.count,
      positive: counts.positive,
      negative: counts.negative,
      neutral: counts.neutral,
      dominant_sentiment: counts.positive > counts.negative ? 'Positive' : counts.negative > counts.positive ? 'Negative' : 'Mixed',
    }))
    .sort((a, b) => b.total_themes - a.total_themes);

  return JSON.stringify({
    themes,
    attribute_summary,
    _coverage: coverageFound({ theme_count: themes.length, attribute_count: attribute_summary.length }),
  });
}

export async function getAttributeBreakdown(ctx: ToolContext, companyId: string): Promise<string> {
  const { admin } = ctx;
  const [responsesResult, themesResult] = await Promise.all([
    admin
      .from('prompt_responses')
      .select('id, ai_model')
      .eq('company_id', companyId)
      .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER),
    admin
      .from('ai_themes')
      .select('response_id, attribute_id, attribute_name, sentiment, theme_name, confidence_score, keywords, context_snippets, prompt_responses!inner(ai_model)')
      .eq('company_id', companyId)
      .not('prompt_responses.ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
      .not('attribute_name', 'is', null),
  ]);

  const responseIds = responsesResult.data || [];
  if (!responseIds.length) return JSON.stringify({
    _coverage: coverageNoData("No AI response data has been collected yet for this company."),
  });

  const data = themesResult.data || [];
  if (themesResult.error) return JSON.stringify({ error: themesResult.error.message });
  if (!data.length) return JSON.stringify({
    _coverage: coverageNoData("No attributes have been extracted for this company yet."),
  });

  const responseModelMap = new Map<string, string>(responseIds.map((r: any) => [r.id, r.ai_model]));

  const attrMap = new Map<string, {
    id: string;
    sentiments: string[];
    themes: string[];
    snippets: string[];
    models: Set<string>;
  }>();

  for (const t of data) {
    const attr = t.attribute_name;
    if (!attr) continue;
    if (!attrMap.has(attr)) {
      attrMap.set(attr, { id: t.attribute_id, sentiments: [], themes: [], snippets: [], models: new Set() });
    }
    const entry = attrMap.get(attr)!;
    if (t.sentiment) entry.sentiments.push(t.sentiment);
    if (t.theme_name) entry.themes.push(t.theme_name);
    if (t.context_snippets?.length) entry.snippets.push(...t.context_snippets.slice(0, 2));
    const model = responseModelMap.get(t.response_id);
    if (model) entry.models.add(model);
  }

  const attributes = Array.from(attrMap.entries()).map(([attr_name, stats]) => {
    // Methodology v2: score = positive/(positive+negative) as 0-100;
    // 50 = balanced/no polarized signal. Numeric sentiment_score not used.
    const posCount = stats.sentiments.filter(s => s === 'positive').length;
    const negCount = stats.sentiments.filter(s => s === 'negative').length;
    const polarized = posCount + negCount;
    return {
      attribute: attr_name,
      score_out_of_100: polarized > 0 ? Math.round((posCount / polarized) * 100) : 50,
      sentiment_label: posCount > negCount ? 'Positive' : negCount > posCount ? 'Negative' : 'Mixed',
      positive_count: posCount,
      negative_count: negCount,
      neutral_count: stats.sentiments.filter(s => s === 'neutral').length,
      top_themes: [...new Set(stats.themes)].slice(0, 5),
      ai_models_mentioning: Array.from(stats.models),
      sample_snippets: stats.snippets.slice(0, 3),
    };
  }).sort((a, b) => b.score_out_of_100 - a.score_out_of_100);

  return JSON.stringify({
    attributes: attributes,
    total_attributes: attributes.length,
    _coverage: coverageFound({ attribute_count: attributes.length }),
  });
}

export async function getCompetitors(ctx: ToolContext, companyId: string): Promise<string> {
  const { admin } = ctx;
  const { data } = await admin
    .from('prompt_responses')
    .select('detected_competitors, ai_model')
    .eq('company_id', companyId)
    .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
    .not('detected_competitors', 'is', null);

  const { count: total } = await admin
    .from('prompt_responses')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER);

  const competitorCounts = new Map<string, { count: number; models: Set<string> }>();
  for (const r of (data || [])) {
    if (!r.detected_competitors) continue;
    const comps = r.detected_competitors.split(',').map((c: string) => c.trim()).filter(Boolean);
    for (const comp of comps) {
      if (!competitorCounts.has(comp)) competitorCounts.set(comp, { count: 0, models: new Set() });
      const entry = competitorCounts.get(comp)!;
      entry.count++;
      if (r.ai_model) entry.models.add(r.ai_model);
    }
  }

  const competitors = Array.from(competitorCounts.entries())
    .map(([name, stats]) => ({
      name,
      mentions: stats.count,
      mention_rate: total > 0 ? `${Math.round((stats.count / total) * 100)}%` : '0%',
      mentioned_by_models: Array.from(stats.models),
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 15);

  const coverage = competitors.length === 0
    ? coverageNoData("No competitor mentions have been detected in AI responses for this company yet.")
    : coverageFound({ competitor_count: competitors.length, analyzed_responses: total || 0 });
  return JSON.stringify({ competitors, total_responses: total || 0, _coverage: coverage });
}

export async function getCitations(
  ctx: ToolContext,
  companyId: string,
  includeSnippets?: boolean,
  domainFilter?: string
): Promise<string> {
  const { admin } = ctx;
  const { data, error } = await admin
    .from('prompt_responses')
    .select('citations, ai_model')
    .eq('company_id', companyId)
    .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER)
    .not('citations', 'is', null);

  if (error) return JSON.stringify({ error: error.message });

  let totalCitations = 0;
  const domainMap = new Map<string, {
    count: number;
    models: Set<string>;
    titles: string[];
    snippets: string[];
    urls: string[];
  }>();

  for (const r of (data || [])) {
    let citationsList: any[];
    try {
      citationsList = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
      if (!Array.isArray(citationsList)) continue;
    } catch { continue; }

    for (const citation of citationsList) {
      if (!citation || typeof citation !== 'object') continue;

      let domain = citation.domain || citation.source || null;
      if (!domain && citation.url) {
        try {
          domain = new URL(citation.url).hostname;
        } catch { continue; }
      }
      if (!domain) continue;

      domain = domain.replace(/^www\./, '').toLowerCase();

      if (domainFilter && !domain.includes(domainFilter.replace(/^www\./, '').toLowerCase())) continue;

      totalCitations++;

      if (!domainMap.has(domain)) {
        domainMap.set(domain, { count: 0, models: new Set(), titles: [], snippets: [], urls: [] });
      }
      const entry = domainMap.get(domain)!;
      entry.count++;
      if (r.ai_model) entry.models.add(r.ai_model);

      if (includeSnippets) {
        if (citation.title && entry.titles.length < 3 && !entry.titles.includes(citation.title)) {
          entry.titles.push(citation.title);
        }
        if (citation.snippet && entry.snippets.length < 3) {
          entry.snippets.push(citation.snippet.substring(0, 200));
        }
        if (citation.url && entry.urls.length < 3) {
          entry.urls.push(citation.url);
        }
      }
    }
  }

  const citations = Array.from(domainMap.entries())
    .map(([domain, stats]) => {
      const result: any = {
        domain,
        count: stats.count,
        share: totalCitations > 0 ? `${Math.round((stats.count / totalCitations) * 100)}%` : '0%',
        cited_by_models: Array.from(stats.models),
      };
      if (includeSnippets) {
        result.sample_titles = stats.titles;
        result.sample_snippets = stats.snippets;
        result.sample_urls = stats.urls;
      }
      return result;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, domainFilter ? 50 : 20);

  if (citations.length === 0) {
    return JSON.stringify({
      citations: [],
      total_citations: 0,
      _coverage: coverageNoData(
        domainFilter
          ? `No citations found for domain matching "${domainFilter}".`
          : "No citations have been captured for this company yet."
      ),
    });
  }

  return JSON.stringify({
    citations,
    total_citations: totalCitations,
    _coverage: coverageFound({ unique_domains: citations.length, total_citation_events: totalCitations }),
  });
}

export async function compareCompanies(ctx: ToolContext, companyIds: string[]): Promise<string> {
  const ids = companyIds.slice(0, 10);
  const results = await Promise.all(ids.map(id => computeMetrics(ctx.admin, id)));
  const missing = results.filter((r: any) => r.noData).map((r: any) => r.company);
  const coverage = missing.length === 0
    ? coverageFound({ compared: results.length })
    : coveragePartial(
        `${missing.length} of ${results.length} companies have no data yet and are excluded from the comparison.`,
        { companies_without_data: missing }
      );
  return JSON.stringify({ comparison: results, _coverage: coverage });
}

export async function getModelBreakdown(ctx: ToolContext, companyId: string): Promise<string> {
  const { admin } = ctx;
  const { data: responses, error } = await admin
    .from('prompt_responses')
    .select('id, ai_model, company_mentioned')
    .eq('company_id', companyId)
    .not('ai_model', 'in', EXCLUDED_AI_MODELS_FILTER);

  if (error) return JSON.stringify({ error: error.message });
  if (!responses?.length) return JSON.stringify({
    _coverage: coverageNoData("No AI response data has been collected yet for this company."),
  });

  const sentimentMap = await getResponseSentiments(admin, responses.map((r: any) => r.id));

  const modelMap = new Map<string, { total: number; mentioned: number; pos: number; neg: number; positive: number; negative: number; neutral: number }>();

  for (const r of responses) {
    const model = r.ai_model || 'unknown';
    if (!modelMap.has(model)) modelMap.set(model, { total: 0, mentioned: 0, pos: 0, neg: 0, positive: 0, negative: 0, neutral: 0 });
    const entry = modelMap.get(model)!;
    entry.total++;
    if (r.company_mentioned) entry.mentioned++;

    const s = sentimentMap.get(r.id);
    if (s) {
      entry.pos += s.pos;
      entry.neg += s.neg;
      if (s.label === 'positive') entry.positive++;
      else if (s.label === 'negative') entry.negative++;
      else entry.neutral++;
    } else {
      entry.neutral++;
    }
  }

  // Methodology v2: per-platform sentiment pools positive/negative theme
  // counts across the platform's responses; percentage, null = no
  // opinionated signal.
  const breakdown = Array.from(modelMap.entries()).map(([model, stats]) => ({
    platform: model,
    total_responses: stats.total,
    visibility_rate: `${Math.round((stats.mentioned / stats.total) * 100)}%`,
    positive_sentiment_pct: sentimentPct(stats.pos, stats.neg),
    sentiment_breakdown: { positive: stats.positive, negative: stats.negative, neutral: stats.neutral },
    dominant_sentiment: stats.positive > stats.negative ? 'Positive' : stats.negative > stats.positive ? 'Negative' : 'Neutral',
  })).sort((a, b) => b.total_responses - a.total_responses);

  return JSON.stringify({
    model_breakdown: breakdown,
    _coverage: coverageFound({ model_count: breakdown.length, total_responses: responses.length }),
  });
}

export async function searchResponses(ctx: ToolContext, companyId: string, keyword: string, limit?: number): Promise<string> {
  const { admin } = ctx;
  const maxLimit = Math.min(limit || 10, 30);

  const { data, error } = await admin
    .from('prompt_responses')
    .select(`
      id, ai_model, response_text, tested_at,
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

  const results = (data || []).map((r: any) => ({
    ai_model: r.ai_model,
    prompt: r.confirmed_prompts?.prompt_text,
    prompt_type: r.confirmed_prompts?.prompt_type,
    sentiment: sentimentMap.get(r.id)?.label || null,
    snippet: extractSnippet(r.response_text || '', keyword, 300),
    period: r.tested_at ? quarterLabel(monthToQuarter(String(r.tested_at))) : null,
  }));

  const coverage = results.length === 0
    ? coverageNoData(`No AI responses for this company mention "${keyword}".`)
    : coverageFound({ matches: results.length, keyword });
  return JSON.stringify({ keyword, results_found: results.length, results, _coverage: coverage });
}
