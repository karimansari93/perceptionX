export interface ReportRequest {
  company_id: string;
  period1: string; // YYYY-MM format
  period2: string; // YYYY-MM format
  market: string;
}

export interface PeriodRange {
  start: string; // ISO date string
  end: string;   // ISO date string
  label: string; // e.g. "Mar 2025"
}

export interface PromptResponseRow {
  id: string;
  ai_model: string;
  citations: any[] | null;
  company_mentioned: boolean | null;
  detected_competitors: string | null;
  confirmed_prompt_id: string;
  created_at: string;
  mention_ranking: number | null;
  response_text: string;
  sentiment_label: string | null;
  sentiment_score: number | null;
  tested_at: string;
  company_id: string | null;
  confirmed_prompts: {
    prompt_type: string | null;
    prompt_category: string;
  };
}

export interface PeriodMetrics {
  totalResponses: number;
  visibilityPct: number;
  discoveryPct: number;
  relevancePct: number;
  competitors: CompetitorMetric[];
  sources: SourceMetric[];
  themes: ThemeMetric[];
}

export interface CompetitorMetric {
  name: string;
  count: number;
  pct: number; // % of discovery responses
}

export interface SourceMetric {
  domain: string;
  count: number;
  pct: number; // % of total responses
}

export interface ThemeMetric {
  label: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  count: number;
}

export interface ReportData {
  companyName: string;
  market: string;
  period1Label: string;
  period2Label: string;
  period1: PeriodMetrics;
  period2: PeriodMetrics;
}
