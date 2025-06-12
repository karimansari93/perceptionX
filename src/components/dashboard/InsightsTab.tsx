import { DashboardMetrics, CitationCount, PromptResponse } from "@/types/dashboard";

interface InsightsTabProps {
  metrics: DashboardMetrics;
  responses: PromptResponse[];
  topCompetitors: { company: string; count: number }[];
  topCitations: CitationCount[];
}

export const InsightsTab = (_props: InsightsTabProps) => {
  // Insights section removed as requested
  return null;
}; 