import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { SubscriptionService } from "@/services/subscription";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'sentiment' | 'visibility' | 'competitive';
  sentiment?: string | number;
  visibility?: string | number;
  competitive?: string | number;
  sentimentLabel?: string;
}

interface PromptsTableProps {
  prompts: GeneratedPrompt[];
  companyName?: string;
}

export const PromptsLimitIndicator = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) return;
      try {
        const data = await SubscriptionService.getUserSubscription(user.id);
        setSubscription(data);
      } catch (error) {
        console.error('Error fetching subscription:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, [user]);

  if (loading || !subscription) return null;

  const limit = 3;
  const used = subscription.prompts_used || 0;
  const percentage = (used / limit) * 100;
  const isNearLimit = percentage >= 80;

  return (
    <div className="mb-6">
      <Progress value={percentage} className="h-2 mb-2" />
    </div>
  );
};

export const PromptsHeader = ({ companyName }: { companyName?: string }) => {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">Let's setup your monitoring strategy</h2>
      <p className="text-gray-600">
        We'll test how different AI models respond to three key questions about {companyName || '(Company name)'} as an employer. This takes about 2 minutes to complete.
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
