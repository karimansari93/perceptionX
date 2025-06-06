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
                <TableHead className="text-center">Competitive</TableHead>
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
                    {prompt.type === 'sentiment'
                      ? (
                        <span className={`font-semibold ${getSentimentColor(prompt.avgSentiment)}`}>
                          {prompt.sentimentLabel === 'neutral' ? 'normal' : `${Math.round(prompt.avgSentiment * 100)}% ${prompt.sentimentLabel}`}
                        </span>
                      ) : '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    {prompt.type === 'visibility'
                      ? (
                        <span className="font-semibold text-blue-600">
                          {typeof prompt.averageVisibility === 'number' ? `${Math.round(prompt.averageVisibility)}%` : '-'}
                        </span>
                      ) : '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    {prompt.type === 'competitive'
                      ? (
                        <span className="font-semibold text-purple-600">
                          {getCompetitiveScore(prompt).toFixed(0)}%
                        </span>
                      ) : '-'}
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
