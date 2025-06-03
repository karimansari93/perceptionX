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
  workplace_themes: WorkplaceTheme[] | null;
  confirmed_prompts: {
    prompt_text: string;
    prompt_category: string;
    prompt_type?: string;
  };
  first_mention_position?: number;
  total_words?: number;
}

export interface WorkplaceTheme {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  context: string;
  sentiment: 'positive' | 'neutral' | 'negative';
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
  mentionRanking?: number;
  competitivePosition?: number;
  competitorMentions?: string[];
  averageVisibility?: number;
  totalWords?: number;
  firstMentionPosition?: number;
}

export interface DashboardMetrics {
  averageSentiment: number;
  sentimentLabel: string;
  sentimentTrendComparison: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  totalCitations: number;
  uniqueDomains: number;
  totalResponses: number;
  averageVisibility: number;
}

export interface VisibilityMetrics {
  mentionRate: number;
  averageRanking: number | null;
  totalVisibilityPrompts: number;
  competitorCounts: Record<string, number>;
}
