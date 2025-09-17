export interface CompanyReportData {
  companyName: string;
  industry: string;
  totalResponses: number;
  averageSentiment: number;
  visibilityScore: number;
  competitivePosition: number;
  topThemes: ThemeData[];
  competitorMentions: CompetitorMention[];
  aiModelPerformance: AIModelPerformance[];
  geographicAnalysis: GeographicAnalysis;
  keyInsights: string[];
  recommendations: string[];
  reportDate: string;
}

export interface GeographicAnalysis {
  totalSources: number;
  countries: Array<{
    country: string;
    region: string;
    flag: string;
    sources: number;
    percentage: number;
    domains: string[];
  }>;
  regions: Array<{
    region: string;
    sources: number;
    percentage: number;
    countries: string[];
  }>;
  topCountries: Array<{
    country: string;
    flag: string;
    sources: number;
    percentage: number;
  }>;
  geographicInsights: string[];
}

export interface ThemeData {
  theme_name: string;
  theme_description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  talentx_attribute_id: string;
  talentx_attribute_name: string;
  frequency: number;
  confidence_score: number;
}

export interface CompetitorMention {
  competitor: string;
  frequency: number;
  sentiment: number;
}

export interface AIModelPerformance {
  model: string;
  responses: number;
  averageSentiment: number;
  mentionRate: number;
}

export interface ComparisonData {
  companies: CompanyReportData[];
  comparisonInsights: string[];
  competitiveAnalysis: {
    bestPerforming: string;
    mostVisible: string;
    strongestThemes: string;
    areasForImprovement: string[];
  };
}

export interface CompanyReportRequest {
  companyIds: string[];
  comparisonMode?: boolean;
}

export interface CompanyReportResponse {
  success: boolean;
  data?: CompanyReportData | ComparisonData;
  error?: string;
}
