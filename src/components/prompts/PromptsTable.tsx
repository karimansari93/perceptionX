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
  companyName?: string;
}

export const PromptsHeader = ({ companyName }: { companyName?: string }) => {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">Let's setup your monitoring strategy</h2>
      <p className="text-gray-600">
      We'll test how AI models respond to three key questions about {companyName || '(Company name)'} as an employer. This takes about 2 minutes to complete.
      </p>
    </div>
  );
};

export const PromptsTable = ({ prompts, companyName }: PromptsTableProps) => {
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
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Type</TableHead>
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
