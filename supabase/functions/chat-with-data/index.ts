import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// ─── Tool Definitions ───────────────────────────────────────────────────────

const tools = [
  {
    name: "list_companies",
    description: "List all companies/locations in the user's organization. Always call this first if you don't already know the company IDs. Returns id, name, country, industries, and total_responses for each.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_company_overview",
    description: "Get a comprehensive snapshot for a company: EPS score, sentiment breakdown, visibility %, relevance score, top themes, top competitors, and top citation sources — all in one call. Use this as your default first tool when a user asks about a specific company.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_company_metrics",
    description: "Get just the KPI metrics for a company: EPS, sentiment score/label, visibility %, relevance score, total responses. EPS = 50% sentiment + 30% visibility + 20% relevance.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_responses",
    description: "Get actual AI response texts for a company. Essential for qualitative questions like 'what do AI models say about X', 'how is the culture described', 'what are the negatives'. Returns the full response text, which AI model wrote it, sentiment, and the prompt asked. Filter by prompt_type for focused analysis.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
        limit: { type: "number", description: "Max responses to return (default 15, max 50)" },
        prompt_type: {
          type: "string",
          description: "Optional filter: 'informational' (basic facts), 'experience' (culture/work experience), 'competitive' (vs competitors), 'discovery' (would you recommend). Leave empty for all types.",
        },
        ai_model: {
          type: "string",
          description: "Optional filter by AI model: 'gpt-4', 'claude', 'gemini', 'perplexity', etc.",
        },
        sentiment_filter: {
          type: "string",
          description: "Optional filter: 'positive', 'negative', 'neutral'",
        },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_themes",
    description: "Get recurring themes extracted from AI responses for a company. Each theme has a sentiment score and mention count. Themes represent what AI models consistently talk about (e.g. 'work-life balance', 'innovation', 'compensation'). Also returns TalentX attribute coverage.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_talentx_breakdown",
    description: "Get detailed TalentX attribute scores for a company. TalentX attributes are the employer brand pillars (Culture, Leadership, Compensation, Career Growth, etc.) and shows how AI models perceive each one. Use this for deep-dive employer brand analysis.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_competitors",
    description: "Get competitor mention analysis for a company — which competitors are brought up by AI models, how often, and in what context (co-mentioned vs positioned against).",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_citations",
    description: "Get citation sources (websites/domains) that AI models reference when discussing this company. Returns domain, count, share %, and which AI models cited it. Set include_snippets=true to also get the actual page titles and snippets from each citation — use this when the user asks HOW a source is being used (e.g. 'how does Glassdoor appear in responses?'). Do NOT call get_responses alongside this for citation questions — this tool already has all the source context you need.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
        include_snippets: {
          type: "boolean",
          description: "Set to true to include page titles and text snippets from each citation. Use when the user wants to know what specific content is being cited.",
        },
        domain_filter: {
          type: "string",
          description: "Optional: filter to only return citations from a specific domain (e.g. 'glassdoor.com'). Use when drilling into a specific source.",
        },
      },
      required: ["company_id"],
    },
  },
  {
    name: "compare_companies",
    description: "Compare key metrics (EPS, sentiment, visibility, relevance) side by side for 2–10 companies. Best for comparing locations, subsidiaries, or competitors.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of company UUIDs to compare (2–10)",
        },
      },
      required: ["company_ids"],
    },
  },
  {
    name: "get_model_breakdown",
    description: "Break down how different AI models (ChatGPT, Claude, Gemini, Perplexity, DeepSeek) each perceive a company differently. Useful for understanding which AI models are most or least favorable.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "search_responses",
    description: "Full-text search through AI response texts for a company to find responses that mention specific topics, keywords, or themes. Use this when the user asks about a very specific topic.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "The company UUID" },
        keyword: { type: "string", description: "The keyword or phrase to search for in response texts" },
        limit: { type: "number", description: "Max results to return (default 10)" },
      },
      required: ["company_id", "keyword"],
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────────────

async function executeTool(
  supabaseAdmin: any,
  organizationId: string,
  toolName: string,
  toolInput: any
): Promise<string> {
  try {
    switch (toolName) {
      case "list_companies":
        return await listCompanies(supabaseAdmin, organizationId);
      case "get_company_overview":
        return await getCompanyOverview(supabaseAdmin, toolInput.company_id);
      case "get_company_metrics":
        return await getCompanyMetrics(supabaseAdmin, toolInput.company_id);
      case "get_responses":
        return await getResponses(supabaseAdmin, toolInput.company_id, toolInput.limit, toolInput.prompt_type, toolInput.ai_model, toolInput.sentiment_filter);
      case "get_themes":
        return await getThemes(supabaseAdmin, toolInput.company_id);
      case "get_talentx_breakdown":
        return await getTalentXBreakdown(supabaseAdmin, toolInput.company_id);
      case "get_competitors":
        return await getCompetitors(supabaseAdmin, toolInput.company_id);
      case "get_citations":
        return await getCitations(supabaseAdmin, toolInput.company_id, toolInput.include_snippets, toolInput.domain_filter);
      case "compare_companies":
        return await compareCompanies(supabaseAdmin, toolInput.company_ids);
      case "get_model_breakdown":
        return await getModelBreakdown(supabaseAdmin, toolInput.company_id);
      case "search_responses":
        return await searchResponses(supabaseAdmin, toolInput.company_id, toolInput.keyword, toolInput.limit);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    console.error(`Tool ${toolName} error:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${err.message}` });
  }
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

async function getResponseSentiments(
  supabaseAdmin: any,
  responseIds: string[]
): Promise<Map<string, { label: string; score: number }>> {
  if (!responseIds.length) return new Map();

  const { data: themes } = await supabaseAdmin
    .from('ai_themes')
    .select('response_id, sentiment, sentiment_score')
    .in('response_id', responseIds);

  const grouped = new Map<string, { scores: number[]; sentiments: string[] }>();
  for (const t of (themes || [])) {
    if (!grouped.has(t.response_id)) grouped.set(t.response_id, { scores: [], sentiments: [] });
    const entry = grouped.get(t.response_id)!;
    if (typeof t.sentiment_score === 'number') entry.scores.push(t.sentiment_score);
    if (t.sentiment) entry.sentiments.push(t.sentiment);
  }

  const result = new Map<string, { label: string; score: number }>();
  for (const [id, data] of grouped) {
    const avgScore = data.scores.length > 0
      ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
      : 0;
    const pos = data.sentiments.filter(s => s === 'positive').length;
    const neg = data.sentiments.filter(s => s === 'negative').length;
    const label = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
    result.set(id, { label, score: Math.round(avgScore * 100) / 100 });
  }

  return result;
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function listCompanies(supabaseAdmin: any, organizationId: string): Promise<string> {
  const { data: orgCompanies, error: orgError } = await supabaseAdmin
    .from('organization_companies')
    .select('company_id')
    .eq('organization_id', organizationId);

  if (orgError) return JSON.stringify({ companies: [], error: orgError.message });
  if (!orgCompanies?.length) return JSON.stringify({ companies: [], message: "No companies found in this organization." });

  const companyIds = orgCompanies.map((oc: any) => oc.company_id);

  const [companiesResult, industriesResult, responseCounts, onboardingResult] = await Promise.all([
    supabaseAdmin.from('companies').select('id, name').in('id', companyIds),
    supabaseAdmin.from('company_industries').select('company_id, industry').in('company_id', companyIds),
    supabaseAdmin.from('prompt_responses').select('company_id').in('company_id', companyIds),
    supabaseAdmin.from('user_onboarding').select('company_id, country').in('company_id', companyIds).order('created_at', { ascending: false }),
  ]);

  const countriesMap = new Map<string, string>();
  for (const r of (onboardingResult.data || [])) {
    if (r.company_id && !countriesMap.has(r.company_id)) countriesMap.set(r.company_id, r.country || 'Unknown');
  }

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
    country: countriesMap.get(c.id) || null,
    industries: Array.from(industriesMap.get(c.id) || []),
    total_responses: countMap.get(c.id) || 0,
  }));

  return JSON.stringify({ companies, total: companies.length });
}

async function computeMetrics(supabaseAdmin: any, companyId: string) {
  const [responsesResult, themesResult, relevanceResult, companyResult] = await Promise.all([
    supabaseAdmin
      .from('prompt_responses')
      .select('id, company_mentioned')
      .eq('company_id', companyId),
    supabaseAdmin
      .from('ai_themes')
      .select('sentiment_score, theme_name')
      .eq('company_id', companyId),
    supabaseAdmin.from('company_relevance_scores').select('relevance_score').eq('company_id', companyId).maybeSingle(),
    supabaseAdmin.from('companies').select('name').eq('id', companyId).single(),
  ]);

  const responses = responsesResult.data || [];
  const themes = themesResult.data || [];
  const totalResponses = responses.length;

  if (totalResponses === 0) {
    return { company: companyResult.data?.name, companyId, noData: true };
  }

  const positiveThemes = themes.filter((t: any) => (t.sentiment_score || 0) > 0.1).length;
  const sentimentScore = themes.length > 0 ? positiveThemes / themes.length : 0;
  const sentimentPct = Math.round(sentimentScore * 100);
  const sentimentLabel = sentimentScore > 0.6 ? 'Positive' : sentimentScore < 0.4 ? 'Negative' : 'Neutral';

  const mentioned = responses.filter((r: any) => r.company_mentioned).length;
  const visibilityPct = Math.round((mentioned / totalResponses) * 100);
  const relevancePct = Math.round(relevanceResult.data?.relevance_score || 0);

  const eps = Math.round(sentimentPct * 0.5 + visibilityPct * 0.3 + relevancePct * 0.2);
  const epsLabel = eps >= 80 ? 'Excellent' : eps >= 65 ? 'Good' : eps >= 50 ? 'Fair' : 'Poor';

  return {
    company: companyResult.data?.name,
    companyId,
    eps,
    eps_label: epsLabel,
    sentiment: { score: sentimentPct, label: sentimentLabel, positive_themes: positiveThemes, total_themes: themes.length },
    visibility: visibilityPct,
    relevance: relevancePct,
    total_responses: totalResponses,
    mentioned_count: mentioned,
  };
}

async function getCompanyMetrics(supabaseAdmin: any, companyId: string): Promise<string> {
  const metrics = await computeMetrics(supabaseAdmin, companyId);
  if (metrics.noData) return JSON.stringify({ company: metrics.company, message: "No response data available yet." });
  return JSON.stringify({ ...metrics, formula: "EPS = 50% sentiment + 30% visibility + 20% relevance" });
}

async function getCompanyOverview(supabaseAdmin: any, companyId: string): Promise<string> {
  const [metricsData, themesData, competitorsData, citationsData] = await Promise.all([
    computeMetrics(supabaseAdmin, companyId),
    getThemes(supabaseAdmin, companyId),
    getCompetitors(supabaseAdmin, companyId),
    getCitations(supabaseAdmin, companyId, false),
  ]);

  const themes = JSON.parse(themesData);
  const competitors = JSON.parse(competitorsData);
  const citations = JSON.parse(citationsData);

  return JSON.stringify({
    metrics: metricsData,
    top_themes: themes.themes?.slice(0, 8) || [],
    top_competitors: competitors.competitors?.slice(0, 5) || [],
    top_citations: citations.citations?.slice(0, 5) || [],
  });
}

async function getResponses(
  supabaseAdmin: any,
  companyId: string,
  limit?: number,
  promptType?: string,
  aiModel?: string,
  sentimentFilter?: string
): Promise<string> {
  const maxLimit = Math.min(limit || 15, 50);

  let query = supabaseAdmin
    .from('prompt_responses')
    .select(`
      id, ai_model, response_text,
      company_mentioned, detected_competitors, tested_at,
      confirmed_prompts(prompt_text, prompt_category, prompt_type)
    `)
    .eq('company_id', companyId)
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
  const sentimentMap = await getResponseSentiments(supabaseAdmin, responseIds);

  if (sentimentFilter) {
    filtered = filtered.filter((r: any) => {
      const s = sentimentMap.get(r.id);
      return s ? s.label === sentimentFilter : sentimentFilter === 'neutral';
    });
  }

  filtered = filtered.slice(0, maxLimit);

  const responses = filtered.map((r: any) => {
    const s = sentimentMap.get(r.id);
    return {
      id: r.id,
      ai_model: r.ai_model,
      prompt: r.confirmed_prompts?.prompt_text,
      prompt_type: r.confirmed_prompts?.prompt_type,
      response_text: r.response_text?.length > 1000
        ? r.response_text.substring(0, 1000) + '... [truncated]'
        : r.response_text,
      sentiment: s?.label || null,
      sentiment_score: s?.score ?? null,
      company_mentioned: r.company_mentioned,
      competitors_mentioned: r.detected_competitors,
      date: r.tested_at,
    };
  });

  return JSON.stringify({ total_returned: responses.length, responses });
}

async function getThemes(supabaseAdmin: any, companyId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('ai_themes')
    .select('theme_name, theme_description, sentiment, sentiment_score, talentx_attribute_name, confidence_score, keywords')
    .eq('company_id', companyId);

  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ themes: [], message: "No themes extracted for this company yet." });

  const themeMap = new Map<string, {
    totalScore: number;
    occurrences: number;
    sentiment_counts: { positive: number; negative: number; neutral: number };
    talentx_attributes: Set<string>;
    descriptions: string[];
    keywords: Set<string>;
  }>();

  for (const t of data) {
    const key = t.theme_name;
    if (!themeMap.has(key)) {
      themeMap.set(key, { totalScore: 0, occurrences: 0, sentiment_counts: { positive: 0, negative: 0, neutral: 0 }, talentx_attributes: new Set(), descriptions: [], keywords: new Set() });
    }
    const entry = themeMap.get(key)!;
    entry.totalScore += (t.sentiment_score || 0);
    entry.occurrences++;
    if (t.sentiment) entry.sentiment_counts[t.sentiment as 'positive' | 'negative' | 'neutral']++;
    if (t.talentx_attribute_name) entry.talentx_attributes.add(t.talentx_attribute_name);
    if (t.theme_description && entry.descriptions.length < 2) entry.descriptions.push(t.theme_description);
    if (t.keywords?.length) t.keywords.slice(0, 3).forEach((k: string) => entry.keywords.add(k));
  }

  const themes = Array.from(themeMap.entries())
    .map(([theme_name, stats]) => {
      const avgScore = stats.totalScore / stats.occurrences;
      return {
        theme: theme_name,
        mentions: stats.occurrences,
        avg_sentiment_score: Math.round(avgScore * 100) / 100,
        sentiment_label: stats.sentiment_counts.positive > stats.sentiment_counts.negative ? 'Positive' :
          stats.sentiment_counts.negative > stats.sentiment_counts.positive ? 'Negative' : 'Mixed/Neutral',
        sentiment_breakdown: stats.sentiment_counts,
        talentx_attributes: Array.from(stats.talentx_attributes),
        description: stats.descriptions[0] || null,
        sample_keywords: Array.from(stats.keywords).slice(0, 5),
      };
    })
    .sort((a, b) => b.mentions - a.mentions);

  const attrMap = new Map<string, { positive: number; negative: number; neutral: number; count: number }>();
  for (const t of data) {
    if (!t.talentx_attribute_name) continue;
    if (!attrMap.has(t.talentx_attribute_name)) attrMap.set(t.talentx_attribute_name, { positive: 0, negative: 0, neutral: 0, count: 0 });
    const entry = attrMap.get(t.talentx_attribute_name)!;
    entry.count++;
    if (t.sentiment) entry[t.sentiment as 'positive' | 'negative' | 'neutral']++;
  }

  const talentx_summary = Array.from(attrMap.entries())
    .map(([attr, counts]) => ({
      attribute: attr,
      total_themes: counts.count,
      positive: counts.positive,
      negative: counts.negative,
      neutral: counts.neutral,
      dominant_sentiment: counts.positive > counts.negative ? 'Positive' : counts.negative > counts.positive ? 'Negative' : 'Mixed',
    }))
    .sort((a, b) => b.total_themes - a.total_themes);

  return JSON.stringify({ themes, talentx_summary });
}

async function getTalentXBreakdown(supabaseAdmin: any, companyId: string): Promise<string> {
  const [responsesResult, themesResult] = await Promise.all([
    supabaseAdmin
      .from('prompt_responses')
      .select('id, ai_model')
      .eq('company_id', companyId),
    supabaseAdmin
      .from('ai_themes')
      .select('response_id, talentx_attribute_id, talentx_attribute_name, sentiment, sentiment_score, theme_name, confidence_score, keywords, context_snippets')
      .eq('company_id', companyId)
      .not('talentx_attribute_name', 'is', null),
  ]);

  const responseIds = responsesResult.data || [];
  if (!responseIds.length) return JSON.stringify({ message: "No data available." });

  const data = themesResult.data || [];
  if (themesResult.error) return JSON.stringify({ error: themesResult.error.message });
  if (!data.length) return JSON.stringify({ message: "No TalentX attribute data available." });

  const responseModelMap = new Map(responseIds.map((r: any) => [r.id, r.ai_model]));

  const attrMap = new Map<string, {
    id: string;
    scores: number[];
    sentiments: string[];
    themes: string[];
    snippets: string[];
    models: Set<string>;
  }>();

  for (const t of data) {
    const attr = t.talentx_attribute_name;
    if (!attr) continue;
    if (!attrMap.has(attr)) {
      attrMap.set(attr, { id: t.talentx_attribute_id, scores: [], sentiments: [], themes: [], snippets: [], models: new Set() });
    }
    const entry = attrMap.get(attr)!;
    if (typeof t.sentiment_score === 'number') entry.scores.push(t.sentiment_score);
    if (t.sentiment) entry.sentiments.push(t.sentiment);
    if (t.theme_name) entry.themes.push(t.theme_name);
    if (t.context_snippets?.length) entry.snippets.push(...t.context_snippets.slice(0, 2));
    const model = responseModelMap.get(t.response_id);
    if (model) entry.models.add(model);
  }

  const attributes = Array.from(attrMap.entries()).map(([attr_name, stats]) => {
    const avgScore = stats.scores.length > 0
      ? stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length
      : 0;
    const posCount = stats.sentiments.filter(s => s === 'positive').length;
    const negCount = stats.sentiments.filter(s => s === 'negative').length;
    return {
      attribute: attr_name,
      avg_sentiment_score: Math.round(avgScore * 100) / 100,
      score_out_of_100: Math.round((avgScore + 1) / 2 * 100),
      sentiment_label: posCount > negCount ? 'Positive' : negCount > posCount ? 'Negative' : 'Mixed',
      positive_count: posCount,
      negative_count: negCount,
      neutral_count: stats.sentiments.filter(s => s === 'neutral').length,
      top_themes: [...new Set(stats.themes)].slice(0, 5),
      ai_models_mentioning: Array.from(stats.models),
      sample_snippets: stats.snippets.slice(0, 3),
    };
  }).sort((a, b) => b.score_out_of_100 - a.score_out_of_100);

  return JSON.stringify({ talentx_attributes: attributes, total_attributes: attributes.length });
}

async function getCompetitors(supabaseAdmin: any, companyId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('prompt_responses')
    .select('detected_competitors, ai_model')
    .eq('company_id', companyId)
    .not('detected_competitors', 'is', null);

  const { count: total } = await supabaseAdmin
    .from('prompt_responses')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

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

  return JSON.stringify({ competitors, total_responses: total || 0 });
}

async function getCitations(
  supabaseAdmin: any,
  companyId: string,
  includeSnippets?: boolean,
  domainFilter?: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('prompt_responses')
    .select('citations, ai_model')
    .eq('company_id', companyId)
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
      message: domainFilter
        ? `No citations found for domain matching "${domainFilter}"`
        : "No citations found for this company.",
    });
  }

  return JSON.stringify({ citations, total_citations: totalCitations });
}

async function compareCompanies(supabaseAdmin: any, companyIds: string[]): Promise<string> {
  const ids = companyIds.slice(0, 10);
  const results = await Promise.all(ids.map(id => computeMetrics(supabaseAdmin, id)));
  return JSON.stringify({ comparison: results });
}

async function getModelBreakdown(supabaseAdmin: any, companyId: string): Promise<string> {
  const { data: responses, error } = await supabaseAdmin
    .from('prompt_responses')
    .select('id, ai_model, company_mentioned')
    .eq('company_id', companyId);

  if (error) return JSON.stringify({ error: error.message });
  if (!responses?.length) return JSON.stringify({ message: "No data available." });

  const sentimentMap = await getResponseSentiments(supabaseAdmin, responses.map((r: any) => r.id));

  const modelMap = new Map<string, { total: number; mentioned: number; sentimentSum: number; sentimentCount: number; positive: number; negative: number; neutral: number }>();

  for (const r of responses) {
    const model = r.ai_model || 'unknown';
    if (!modelMap.has(model)) modelMap.set(model, { total: 0, mentioned: 0, sentimentSum: 0, sentimentCount: 0, positive: 0, negative: 0, neutral: 0 });
    const entry = modelMap.get(model)!;
    entry.total++;
    if (r.company_mentioned) entry.mentioned++;

    const s = sentimentMap.get(r.id);
    if (s) {
      entry.sentimentSum += s.score;
      entry.sentimentCount++;
      if (s.label === 'positive') entry.positive++;
      else if (s.label === 'negative') entry.negative++;
      else entry.neutral++;
    } else {
      entry.neutral++;
    }
  }

  const breakdown = Array.from(modelMap.entries()).map(([model, stats]) => ({
    model,
    total_responses: stats.total,
    visibility_rate: `${Math.round((stats.mentioned / stats.total) * 100)}%`,
    avg_sentiment: stats.sentimentCount > 0 ? Math.round((stats.sentimentSum / stats.sentimentCount) * 100) / 100 : 0,
    sentiment_breakdown: { positive: stats.positive, negative: stats.negative, neutral: stats.neutral },
    dominant_sentiment: stats.positive > stats.negative ? 'Positive' : stats.negative > stats.positive ? 'Negative' : 'Neutral',
  })).sort((a, b) => b.total_responses - a.total_responses);

  return JSON.stringify({ model_breakdown: breakdown });
}

async function searchResponses(supabaseAdmin: any, companyId: string, keyword: string, limit?: number): Promise<string> {
  const maxLimit = Math.min(limit || 10, 30);

  const { data, error } = await supabaseAdmin
    .from('prompt_responses')
    .select(`
      id, ai_model, response_text, tested_at,
      confirmed_prompts(prompt_text, prompt_type)
    `)
    .eq('company_id', companyId)
    .ilike('response_text', `%${keyword}%`)
    .order('tested_at', { ascending: false })
    .limit(maxLimit);

  if (error) return JSON.stringify({ error: error.message });

  const responseIds = (data || []).map((r: any) => r.id);
  const sentimentMap = await getResponseSentiments(supabaseAdmin, responseIds);

  const results = (data || []).map((r: any) => ({
    ai_model: r.ai_model,
    prompt: r.confirmed_prompts?.prompt_text,
    prompt_type: r.confirmed_prompts?.prompt_type,
    sentiment: sentimentMap.get(r.id)?.label || null,
    snippet: extractSnippet(r.response_text || '', keyword, 300),
    date: r.tested_at,
  }));

  return JSON.stringify({ keyword, results_found: results.length, results });
}

function extractSnippet(text: string, keyword: string, maxLength: number): string {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(keyword.toLowerCase());
  if (idx === -1) return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + maxLength - 100);
  return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}

// ─── System Prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(orgName: string): string {
  return `You are a senior employer brand analyst for ${orgName}, with access to their PerceptionX data — a platform that tracks how AI models like ChatGPT, Claude, Gemini, and Perplexity describe the company to job seekers.

You have a rich set of tools to query this data. Your job is to give insightful, data-grounded answers that feel like they're coming from a knowledgeable analyst who's reviewed all the data — not from a query engine.

## HOW TO USE TOOLS

**Batch calls aggressively.** Call multiple tools in parallel when you need data from different angles. Don't make the user wait through multiple exchanges.

**Preferred workflow for company questions:**
1. If you don't know company IDs: call \`list_companies\` first
2. For general "how are we doing?" → call \`get_company_overview\` (returns metrics + themes + competitors + citations in one shot)
3. For "what do AI models say about X" → call \`get_responses\` with relevant \`prompt_type\` filter, or use \`search_responses\` for specific topics
4. For citation/source questions (e.g. "what sources are cited?", "how is Glassdoor used?") → call ONLY \`get_citations\`. Do NOT also call \`get_responses\` — citation data is self-contained.
   - For "how is [source] used" or "what content from [source] appears?" → call \`get_citations\` with \`include_snippets: true\` and \`domain_filter: "[domain]"\`
5. For competitor questions → \`get_competitors\`
6. For employer brand depth → \`get_talentx_breakdown\`
7. Comparing locations/subsidiaries → \`compare_companies\`

**IMPORTANT — Schema details you must know:**
- \`ai_themes\` has columns: \`company_id\`, \`response_id\`, \`theme_name\`, \`theme_description\`, \`sentiment\` (positive/negative/neutral), \`sentiment_score\` (-1 to 1), \`talentx_attribute_name\`, \`confidence_score\`, \`keywords\`, \`context_snippets\`
- \`prompt_responses\` has: \`id\`, \`company_id\`, \`confirmed_prompt_id\`, \`ai_model\`, \`response_text\`, \`company_mentioned\` (boolean), \`detected_competitors\`, \`citations\` (JSONB array), \`tested_at\`, \`for_index\`, \`index_period\`
- Sentiment data lives ONLY in \`ai_themes\`, NOT in \`prompt_responses\`. Per-response sentiment is derived by aggregating theme sentiments for that response.
- EPS formula: 50% sentiment + 30% visibility + 20% relevance

## HOW TO RESPOND

- Lead with insight, not raw data dumps. Tell a story about what the data means.
- Use specific numbers and examples from the actual response texts when relevant.
- When discussing qualitative perception, quote or paraphrase from actual AI model responses you retrieved.
- Be direct about weaknesses — users need honest analysis, not spin.
- Use markdown for readability but keep it concise.
- If you notice something surprising or concerning in the data, call it out proactively.
- Max 2–3 tool rounds before producing your answer.`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function sseEvent(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseDone(): Uint8Array {
  return encoder.encode(`data: [DONE]\n\n`);
}

const toolLabels: Record<string, string> = {
  list_companies: 'Looking up companies',
  get_company_overview: 'Loading company overview',
  get_company_metrics: 'Fetching metrics',
  get_responses: 'Reading AI responses',
  get_themes: 'Analyzing themes',
  get_talentx_breakdown: 'Analyzing TalentX attributes',
  get_competitors: 'Checking competitors',
  get_citations: 'Reviewing citations',
  compare_companies: 'Comparing companies',
  get_model_breakdown: 'Analyzing by AI model',
  search_responses: 'Searching responses',
};

// ─── Auth ───────────────────────────────────────────────────────────────────

async function authenticateAndAuthorize(
  req: Request,
  supabaseAdmin: any,
  organizationId: string
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Invalid authentication' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { data: membership, error: memberError } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberError || !membership) {
    return new Response(
      JSON.stringify({ error: 'You do not have access to this organization' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return { userId: user.id };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message, conversationHistory, organizationId } = await req.json();

    if (!message) throw new Error('Message is required');
    if (!organizationId) throw new Error('Organization ID is required');

    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!claudeApiKey) throw new Error('Claude API key not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase configuration missing');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const authResult = await authenticateAndAuthorize(req, supabaseAdmin, organizationId);
    if (authResult instanceof Response) return authResult;

    const { data: orgData } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    const orgName = orgData?.name || 'Your Organization';
    const systemPrompt = buildSystemPrompt(orgName);

    console.log(`Chat [${orgName}] user=${authResult.userId}: "${message.substring(0, 100)}"`);

    const apiMessages: any[] = [];
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }
    apiMessages.push({ role: 'user', content: message });

    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    });

    const responsePromise = (async () => {
      const ctrl = streamController!;
      try {
        let currentMessages = [...apiMessages];
        const MAX_TOOL_ROUNDS = 10;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          console.log(`--- Round ${round + 1} ---`);

          const streamResult = await handleStreamingRound(
            ctrl, claudeApiKey, systemPrompt, currentMessages, supabaseAdmin, organizationId
          );

          if (streamResult.done) {
            ctrl.enqueue(sseDone());
            ctrl.close();
            return;
          }

          currentMessages = streamResult.messages;
        }

        console.error('Exhausted tool rounds');
        ctrl.enqueue(sseEvent({ text: "I couldn't complete the analysis in time. Please try a more specific question." }));
        ctrl.enqueue(sseDone());
        ctrl.close();
      } catch (err: any) {
        console.error('Stream error:', err);
        try {
          ctrl.enqueue(sseEvent({ error: err.message || 'An unexpected error occurred.' }));
          ctrl.enqueue(sseDone());
          ctrl.close();
        } catch { /* already closed */ }
      }
    })();

    responsePromise.catch(err => console.error('Unhandled stream error:', err));

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Error in chat-with-data:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Streaming Round Handler ────────────────────────────────────────────────

async function handleStreamingRound(
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  claudeApiKey: string,
  systemPrompt: string,
  currentMessages: any[],
  supabaseAdmin: any,
  organizationId: string
): Promise<{ done: boolean; messages: any[] }> {
  const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: currentMessages,
      tools,
      stream: true,
    }),
  });

  if (!claudeResponse.ok) {
    const errorText = await claudeResponse.text();
    console.error(`Claude streaming error (${claudeResponse.status}):`, errorText);
    throw new Error('AI service error');
  }

  const reader = claudeResponse.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = '';
  const contentBlocks: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      let event: any;
      try { event = JSON.parse(data); } catch { continue; }

      switch (event.type) {
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            contentBlocks[event.index] = {
              type: 'tool_use',
              id: event.content_block.id,
              name: event.content_block.name,
              input: '',
            };
          } else if (event.content_block?.type === 'text') {
            contentBlocks[event.index] = { type: 'text', text: '' };
          }
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            if (contentBlocks[event.index]) contentBlocks[event.index].text += event.delta.text;
            ctrl.enqueue(sseEvent({ text: event.delta.text }));
          } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            if (contentBlocks[event.index]) contentBlocks[event.index].input += event.delta.partial_json;
          }
          break;

        case 'message_delta':
          stopReason = event.delta?.stop_reason || '';
          break;
      }
    }
  }

  for (const block of contentBlocks) {
    if (block?.type === 'tool_use' && typeof block.input === 'string') {
      try { block.input = JSON.parse(block.input || '{}'); } catch { block.input = {}; }
    }
  }

  console.log(`Round done: stop=${stopReason}, blocks=${contentBlocks.filter(Boolean).length}`);

  if (stopReason !== 'tool_use') {
    return { done: true, messages: currentMessages };
  }

  const toolBlocks = contentBlocks.filter((b: any) => b?.type === 'tool_use');
  if (!toolBlocks.length) return { done: true, messages: currentMessages };

  const updatedMessages = [...currentMessages, { role: 'assistant', content: contentBlocks.filter(Boolean) }];

  const toolNames = toolBlocks.map((b: any) => toolLabels[b.name] || b.name);
  ctrl.enqueue(sseEvent({ status: toolNames.join(' + ') + '...' }));

  const toolResults = await Promise.all(
    toolBlocks.map(async (block: any) => {
      console.log(`  Tool: ${block.name}(${JSON.stringify(block.input).substring(0, 200)})`);
      const output = await executeTool(supabaseAdmin, organizationId, block.name, block.input);
      console.log(`  Result: ${output.length} chars`);
      return { type: 'tool_result' as const, tool_use_id: block.id, content: output };
    })
  );

  updatedMessages.push({ role: 'user', content: toolResults });
  return { done: false, messages: updatedMessages };
}
