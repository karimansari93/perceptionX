import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'sentiment' | 'visibility' | 'competitive';
}

interface PromptsTableProps {
  prompts: GeneratedPrompt[];
}

export const PromptsTable = ({ prompts }: PromptsTableProps) => {
  const getCategoryColor = (type: string) => {
    const colors: Record<string, string> = {
      'sentiment': 'bg-blue-100 text-blue-800',
      'visibility': 'bg-green-100 text-green-800',
      'competitive': 'bg-purple-100 text-purple-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'sentiment': 'Sentiment',
      'visibility': 'Visibility',
      'competitive': 'Competitive'
    };
    return labels[type] || type;
  };

  return (
    <Card className="bg-white shadow-lg">
      <CardHeader>
        <CardTitle className="text-lg">Your Company Through AI's Eyes</CardTitle>
        <p className="text-gray-600 mt-2 text-base">
          Millions of job seekers are asking AI about employers. We'll show you exactly what they're discovering about National Grid.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead className="w-[150px]">Category</TableHead>
              <TableHead>Prompt Question</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prompts.map((prompt) => (
              <TableRow key={prompt.id}>
                <TableCell>
                  <Badge className={getCategoryColor(prompt.type)}>
                    {getTypeLabel(prompt.type)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-gray-600">
                    {prompt.category}
                  </span>
                </TableCell>
                <TableCell className="font-medium leading-relaxed">
                  {prompt.text}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
