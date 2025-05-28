
import { Json } from "@/integrations/supabase/types";

export interface PromptResponse {
  id: string;
  confirmed_prompt_id: string;
  ai_model: string;
  response_text: string;
  sentiment_score: number | null;
  sentiment_label: string | null;
  citations: Json | null;
  tested_at: string;
  company_mentioned: boolean | null;
  mention_ranking: number | null;
  competitor_mentions: Json | null;
  confirmed_prompts: {
    prompt_text: string;
    prompt_category: string;
    prompt_type?: string;
  };
}

export interface Citation {
  domain?: string;
  title?: string;
  url?: string;
}

export interface CompetitorMention {
  company: string;
  ranking?: number;
  context?: string;
}

export interface SentimentTrendData {
  date: string;
  sentiment: number;
  count: number;
}

export interface CitationCount {
  domain: string;
  count: number;
}

export interface PromptData {
  prompt: string;
  category: string;
  type: string;
  responses: number;
  avgSentiment: number;
  sentimentLabel: string;
}

export interface DashboardMetrics {
  averageSentiment: number;
  sentimentLabel: string;
  totalCitations: number;
  uniqueDomains: number;
  totalResponses: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}

export interface VisibilityMetrics {
  mentionRate: number;
  averageRanking: number | null;
  totalVisibilityPrompts: number;
  competitorCounts: Record<string, number>;
}
