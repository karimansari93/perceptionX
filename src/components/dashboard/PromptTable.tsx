import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PromptData } from "@/types/dashboard";
import { MessageSquare, TrendingUp, TrendingDown, Minus, Target } from "lucide-react";

interface PromptTableProps {
  prompts: PromptData[];
  title: string;
  description: string;
  onPromptClick: (promptText: string) => void;
}

export const PromptTable = ({ prompts, title, description, onPromptClick }: PromptTableProps) => {
  const getSentimentIcon = (sentiment: number) => {
    if (sentiment > 0.1) return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (sentiment < -0.1) return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-600" />;
  };

  const getSentimentColor = (sentiment: number) => {
    if (sentiment > 0.1) return 'text-green-600';
    if (sentiment < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getVisibilityScore = (prompt: PromptData) => {
    return typeof prompt.averageVisibility === 'number' ? prompt.averageVisibility : 0;
  };

  const getCompetitiveScore = (prompt: PromptData) => {
    // Calculate competitive score based on relative positioning and mentions
    const baseScore = prompt.competitivePosition ? (1 / prompt.competitivePosition) * 100 : 0;
    const mentionBonus = prompt.competitorMentions ? prompt.competitorMentions.length * 10 : 0;
    return Math.min(100, baseScore + mentionBonus);
  };

  const getMetricColumn = (prompt: PromptData) => {
    switch (prompt.type) {
      case 'sentiment':
        return (
          <div className="flex items-center justify-center space-x-2">
            {getSentimentIcon(prompt.avgSentiment)}
            <span className={`font-semibold ${getSentimentColor(prompt.avgSentiment)}`}>
              {Math.round(prompt.avgSentiment * 100)}%
            </span>
          </div>
        );
      case 'visibility':
        const visibilityScore = getVisibilityScore(prompt);
        return (
          <div className="flex items-center justify-center space-x-2">
            <Target className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-blue-600">
              {Math.round(visibilityScore)}%
            </span>
          </div>
        );
      case 'competitive':
        const competitiveScore = getCompetitiveScore(prompt);
        return (
          <div className="flex items-center justify-center space-x-2">
            <TrendingUp className="w-4 h-4 text-purple-600" />
            <span className="font-semibold text-purple-600">
              {competitiveScore.toFixed(0)}%
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  // Helper for sentiment pill
  const getSentimentPill = (sentimentLabel?: string) => {
    if (!sentimentLabel) return <span>-</span>;
    let color = "bg-gray-100 text-gray-700";
    let label = "Normal";
    if (sentimentLabel.toLowerCase() === "positive") {
      color = "bg-green-100 text-green-700";
      label = "Positive";
    } else if (sentimentLabel.toLowerCase() === "negative") {
      color = "bg-red-100 text-red-700";
      label = "Negative";
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${color}`}>{label}</span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {prompts.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prompt</TableHead>
                <TableHead className="text-center">Type</TableHead>
                <TableHead className="text-center">Responses</TableHead>
                <TableHead className="text-center">Sentiment</TableHead>
                <TableHead className="text-center">Visibility</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prompts.map((prompt, index) => (
                <TableRow 
                  key={index} 
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => onPromptClick(prompt.prompt)}
                >
                  <TableCell className="font-medium max-w-md">
                    <div className="truncate" title={prompt.prompt}>
                      {prompt.prompt}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{prompt.type.charAt(0).toUpperCase() + prompt.type.slice(1)}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{prompt.responses}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {getSentimentPill(prompt.sentimentLabel)}
                  </TableCell>
                  <TableCell className="text-center">
                    {Array.isArray(prompt.visibilityScores) && prompt.visibilityScores.length > 0 ? (
                      (() => {
                        const avgVisibility = prompt.visibilityScores!.reduce((sum, score) => sum + score, 0) / prompt.visibilityScores!.length;
                        return (
                          <div className="flex items-center gap-1 justify-center">
                            <svg width="20" height="20" viewBox="0 0 20 20" className="-ml-1">
                              <circle
                                cx="10"
                                cy="10"
                                r="8"
                                fill="none"
                                stroke="#e5e7eb"
                                strokeWidth="2"
                              />
                              <circle
                                cx="10"
                                cy="10"
                                r="8"
                                fill="none"
                                stroke={
                                  avgVisibility >= 95 ? '#22c55e' :
                                  avgVisibility >= 60 ? '#4ade80' :
                                  avgVisibility > 0 ? '#fde047' :
                                  '#e5e7eb'
                                }
                                strokeWidth="2"
                                strokeDasharray={2 * Math.PI * 8}
                                strokeDashoffset={2 * Math.PI * 8 * (1 - avgVisibility / 100)}
                                strokeLinecap="round"
                                style={{ transition: 'stroke-dashoffset 0.4s, stroke 0.4s' }}
                              />
                            </svg>
                            <span className="text-xs font-regular text-gray-900">{Math.round(avgVisibility)}%</span>
                          </div>
                        );
                      })()
                    ) : 'N/A'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No {title.toLowerCase()} tracked yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
