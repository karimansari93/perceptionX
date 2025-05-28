import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { ResponseItem } from "./ResponseItem";
import { PromptResponse } from "@/types/dashboard";
import { enhanceCitations } from "@/utils/citationUtils";

interface ResponsesTabProps {
  responses: PromptResponse[];
  parseCitations: (citations: any) => any[];
}

export const ResponsesTab = ({ responses, parseCitations }: ResponsesTabProps) => {
  const truncateText = (text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const getSentimentColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'text-gray-600';
    if (sentimentScore > 0.1) return 'text-green-600';
    if (sentimentScore < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getSentimentBgColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'bg-gray-100';
    if (sentimentScore > 0.1) return 'bg-green-100';
    if (sentimentScore < -0.1) return 'bg-red-100';
    return 'bg-gray-100';
  };

  const parseAndEnhanceCitations = (citations: any) => {
    const parsed = parseCitations(citations);
    return enhanceCitations(parsed);
  };

  return (
    <div className="space-y-4">
      {responses.map((response: PromptResponse) => (
        <ResponseItem
          key={response.id}
          response={response}
          parseAndEnhanceCitations={parseAndEnhanceCitations}
          truncateText={truncateText}
          getSentimentColor={getSentimentColor}
          getSentimentBgColor={getSentimentBgColor}
        />
      ))}
      
      {responses.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p>No responses collected yet. Start monitoring to see AI responses here.</p>
        </div>
      )}
    </div>
  );
};
