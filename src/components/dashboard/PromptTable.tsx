
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PromptData } from "@/types/dashboard";
import { MessageSquare, TrendingUp, TrendingDown, Minus } from "lucide-react";

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
                <TableHead>Category</TableHead>
                <TableHead className="text-center">Responses</TableHead>
                <TableHead className="text-center">Avg Sentiment</TableHead>
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
                  <TableCell>
                    <Badge variant="outline">{prompt.category}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{prompt.responses}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center space-x-2">
                      {getSentimentIcon(prompt.avgSentiment)}
                      <span className={`font-semibold ${getSentimentColor(prompt.avgSentiment)}`}>
                        {prompt.avgSentiment.toFixed(2)}
                      </span>
                    </div>
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
