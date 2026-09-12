import { Json } from "@/integrations/supabase/types";

export interface PromptResponse {
  id: string;
  confirmed_prompt_id: string;
  company_id: string;
  ai_model: string;
  response_text?: string;
  citations: Json | null;
  tested_at: string;
  company_mentioned: boolean | null;
  detected_competitors: string | null;
  confirmed_prompts: {
    prompt_text: string;
    prompt_category: string;
    prompt_theme?: string | null;
    prompt_type?: string;
    industry_context?: string;
    job_function_context?: string | null;
    location_context?: string | null;
  };
  first_mention_position?: number;
  total_words?: number;

  // Fields that exist on the underlying DB row but weren't declared here
  // historically. Report services + admin paths read them off the raw row,
  // and because the main hook selects `*` from prompt_responses they're
  // present at runtime. Declared optional to avoid breaking narrower callers.
  created_at?: string;
  updated_at?: string;
  sentiment_score?: number | null;
  sentiment_label?: string | null;
  visibility_score?: number | null;
  mention_ranking?: number | null;
  for_index?: boolean | null;
  index_period?: string | null;
  // Canonical monthly-snapshot bucket: generated as
  // COALESCE(collection_cycle, date_trunc('month', created_at)). Collection
  // and dedupe stay at this month grain; the dashboard groups periods by the
  // QUARTER containing it (responsePeriodKey) — NOT by tested_at/created_at,
  // which is just when the row was physically written.
  response_month?: string | null;
}

export interface Citation {
  domain?: string;
  title?: string;
  url?: string;
}

export interface CompetitorMention {
  name: string;
  ranking: number | null;
  context: string;
}

export interface SentimentTrendData {
  date: string;
  sentiment: number;
  count: number;
}

export interface CitationCount {
  domain: string;
  count: number;
  mediaType?: 'owned' | 'influenced' | 'organic' | 'competitive' | 'irrelevant';
}

export interface PromptData {
  prompt: string;
  category: string;
  type: string;
  industryContext?: string;
  jobFunctionContext?: string;
  locationContext?: string;
  promptCategory?: string;
  promptTheme?: string;
  responses: number;
  avgSentiment: number;
  sentimentLabel: string;
  mentionRanking?: number;
  competitivePosition?: number;
  detectedCompetitors?: string;
  averageVisibility?: number;
  totalWords?: number;
  firstMentionPosition?: number;
  visibilityScores?: number[];
  // Attribute prompt fields
  isAttributePrompt?: boolean;
  attributeId?: string;
  attributePromptType?: string;
}

// Load status of one dashboard data family (a rollup RPC, the response
// stream, a cube). 'error' means the request failed with nothing cached —
// consumers must render an explicit error/retry state, never an empty state.
export type DashboardFamilyStatus = 'loading' | 'ready' | 'error';

export interface DashboardMetrics {
  // Headline metrics are `null` when UNAVAILABLE: the source family failed,
  // has not loaded, or carries no signal (methodology v2 sentiment with no
  // polarized themes). A calculated 0 is a real 0 and stays a number. The UI
  // renders null as "—" / an explicit unavailable state — never as 0%.
  averageSentiment: number | null;
  sentimentLabel: string;
  sentimentTrendComparison: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  visibilityTrendComparison: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  citationsTrendComparison: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  totalCitations: number;
  uniqueDomains: number;
  totalResponses: number;
  averageVisibility: number | null;
  averageRelevance: number | null;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  // EPS (50/30/20 of the three scores) is null whenever ANY input is null —
  // a missing input is never substituted with 0.
  perceptionScore: number | null;
  perceptionLabel: string;
  sentimentScore: number | null;
  visibilityScore: number | null;
  relevanceScore: number | null;
}

export interface VisibilityMetrics {
  mentionRate: number;
  averageRanking: number | null;
  totalVisibilityPrompts: number;
  competitorCounts: Record<string, number>;
}

export interface LLMMentionRanking {
  model: string;
  displayName: string;
  mentions: number;
  logoUrl: string | null;
}
