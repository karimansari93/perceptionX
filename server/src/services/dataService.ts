import { createClient } from '@supabase/supabase-js';
import {
  PeriodRange,
  PeriodMetrics,
  CompetitorMetric,
  SourceMetric,
  ThemeMetric,
  PromptResponseRow,
  ReportData,
} from '../types';
import { parsePeriod } from '../utils/validators';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function fetchReportData(
  companyId: string,
  period1Str: string,
  period2Str: string,
  market: string
): Promise<ReportData> {
  const p1 = parsePeriod(period1Str);
  const p2 = parsePeriod(period2Str);

  // Get company name
  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('name, industry')
    .eq('id', companyId)
    .single();

  if (companyErr || !company) {
    throw new Error(`Company not found: ${companyId}`);
  }

  // Fetch responses for both periods in parallel
  const [rows1, rows2] = await Promise.all([
    fetchPeriodRows(companyId, p1),
    fetchPeriodRows(companyId, p2),
  ]);

  return {
    companyName: company.name,
    market,
    period1Label: p1.label,
    period2Label: p2.label,
    period1: computeMetrics(rows1),
    period2: computeMetrics(rows2),
  };
}

async function fetchPeriodRows(
  companyId: string,
  period: PeriodRange
): Promise<PromptResponseRow[]> {
  const { data, error } = await supabase
    .from('prompt_responses')
    .select(`
      id,
      ai_model,
      citations,
      company_mentioned,
      detected_competitors,
      confirmed_prompt_id,
      created_at,
      mention_ranking,
      response_text,
      sentiment_label,
      sentiment_score,
      tested_at,
      company_id,
      confirmed_prompts!inner(
        prompt_type,
        prompt_category
      )
    `)
    .eq('company_id', companyId)
    .gte('tested_at', period.start)
    .lte('tested_at', period.end + 'T23:59:59')
    .order('tested_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch responses: ${error.message}`);
  }

  return (data || []) as unknown as PromptResponseRow[];
}

function computeMetrics(rows: PromptResponseRow[]): PeriodMetrics {
  const total = rows.length;
  if (total === 0) {
    return {
      totalResponses: 0,
      visibilityPct: 0,
      discoveryPct: 0,
      relevancePct: 0,
      competitors: [],
      sources: [],
      themes: [],
    };
  }

  // Visibility: company_mentioned = true / total
  const mentioned = rows.filter((r) => r.company_mentioned === true).length;
  const visibilityPct = (mentioned / total) * 100;

  // Discovery: company_mentioned = true among prompt_type = 'discovery'
  const discoveryRows = rows.filter(
    (r) => r.confirmed_prompts?.prompt_type === 'discovery'
  );
  const discoveryMentioned = discoveryRows.filter(
    (r) => r.company_mentioned === true
  ).length;
  const discoveryPct =
    discoveryRows.length > 0
      ? (discoveryMentioned / discoveryRows.length) * 100
      : 0;

  // Relevance: rows with citations array length > 0
  const withCitations = rows.filter((r) => {
    if (!r.citations) return false;
    if (Array.isArray(r.citations)) return r.citations.length > 0;
    return false;
  }).length;
  const relevancePct = (withCitations / total) * 100;

  // Competitors
  const competitorCounts = new Map<string, number>();
  rows.forEach((r) => {
    if (r.detected_competitors && r.detected_competitors.trim()) {
      r.detected_competitors
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .forEach((c) => {
          competitorCounts.set(c, (competitorCounts.get(c) || 0) + 1);
        });
    }
  });
  const discoveryCount = discoveryRows.length || 1;
  const competitors: CompetitorMetric[] = Array.from(competitorCounts.entries())
    .map(([name, count]) => ({
      name,
      count,
      pct: (count / discoveryCount) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Sources
  const sourceCounts = new Map<string, number>();
  rows.forEach((r) => {
    if (!r.citations || !Array.isArray(r.citations)) return;
    r.citations.forEach((citation: any) => {
      const domain = extractDomain(citation);
      if (domain) {
        sourceCounts.set(domain, (sourceCounts.get(domain) || 0) + 1);
      }
    });
  });
  const sources: SourceMetric[] = Array.from(sourceCounts.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      pct: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Themes from sentiment labels
  const themeCounts = new Map<string, { pos: number; neg: number; neu: number }>();
  rows.forEach((r) => {
    const category = r.confirmed_prompts?.prompt_category || 'General';
    if (!themeCounts.has(category)) {
      themeCounts.set(category, { pos: 0, neg: 0, neu: 0 });
    }
    const entry = themeCounts.get(category)!;
    const score = r.sentiment_score || 0;
    if (score > 0.1) entry.pos++;
    else if (score < -0.1) entry.neg++;
    else entry.neu++;
  });
  const themes: ThemeMetric[] = Array.from(themeCounts.entries()).map(
    ([label, counts]) => ({
      label,
      sentiment:
        counts.pos > counts.neg
          ? 'positive'
          : counts.neg > counts.pos
            ? 'negative'
            : 'neutral',
      count: counts.pos + counts.neg + counts.neu,
    })
  );

  return {
    totalResponses: total,
    visibilityPct,
    discoveryPct,
    relevancePct,
    competitors,
    sources,
    themes,
  };
}

function extractDomain(citation: any): string {
  try {
    if (typeof citation === 'string') {
      const url = new URL(citation.startsWith('http') ? citation : `https://${citation}`);
      return url.hostname.replace(/^www\./, '');
    }
    if (citation && typeof citation === 'object') {
      if (citation.url) {
        const url = new URL(
          citation.url.startsWith('http') ? citation.url : `https://${citation.url}`
        );
        return url.hostname.replace(/^www\./, '');
      }
      if (citation.domain) return citation.domain;
      if (citation.source) return citation.source.toLowerCase().trim();
    }
  } catch {
    // ignore malformed URLs
  }
  return '';
}
