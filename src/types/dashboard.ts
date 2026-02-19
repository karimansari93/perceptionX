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

  talentx_scores?: {
    overall_score: number;
    top_attributes: string[];
    attribute_scores: Record<string, number>;
  };
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
  // Experience prompt fields
  isTalentXPrompt?: boolean;
  talentXAttributeId?: string;
  talentXPromptType?: string;
}

export interface DashboardMetrics {
  averageSentiment: number;
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
  averageVisibility: number;
  averageRelevance: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  perceptionScore: number;
  perceptionLabel: string;
  sentimentScore: number;
  visibilityScore: number;
  relevanceScore: number;
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
