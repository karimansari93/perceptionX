export interface TalentXAttribute {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  promptTemplate: string;
  category: string;
  isProOnly: boolean;
}

export interface TalentXAnalysis {
  attributeId: string;
  attributeName: string;
  perceptionScore: number; // 0-100, overall perception score for this attribute
  avgPerceptionScore: number; // average perception score
  avgSentimentScore: number; // average sentiment score
  totalResponses: number; // total number of responses for this attribute
  sentimentAnalyses: any[]; // sentiment analysis data
  competitiveAnalyses: any[]; // competitive analysis data
  visibilityAnalyses: any[]; // visibility analysis data
  totalMentions: number; // total mentions
  context?: string[]; // response snippets mentioning this attribute
}

export interface TalentXResponseAnalysis {
  responseId: string;
  attributeAnalyses: TalentXAnalysis[];
  overallTalentXScore: number; // average of all relevant attributes
  topAttributes: string[]; // top 3 most relevant attributes
} 