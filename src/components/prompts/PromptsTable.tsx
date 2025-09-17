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
import { useSubscription } from '@/hooks/useSubscription';
import { CheckCircle, Info } from 'lucide-react';

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'sentiment' | 'visibility' | 'competitive' | 'talentx';
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
  const { subscription, isPro, getLimits } = useSubscription();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  if (!subscription) return null;

  const limits = getLimits();
  const used = subscription.prompts_used || 0;
  const isUnlimited = isPro;
  const percentage = isUnlimited ? 0 : (used / limits.prompts) * 100;
  const isNearLimit = !isUnlimited && percentage >= 80;

  return (
    <div className="mb-6">
      {isUnlimited ? (
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Pro Plan - Unlimited Prompts</span>
        </div>
      ) : (
        <>
          <Progress value={percentage} className="h-2 mb-2" />
          <div className="flex justify-between text-sm text-gray-600">
            <span>{used} of {limits.prompts} prompts used</span>
            {isNearLimit && (
              <Button
                variant="link"
                className="text-primary p-0 h-auto"
                onClick={() => setShowUpgradeModal(true)}
              >
                Upgrade to Pro
              </Button>
            )}
          </div>
        </>
      )}
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
      'competitive': 'bg-purple-100 text-purple-800',
      'talentx': 'bg-orange-100 text-orange-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'sentiment': 'Sentiment',
      'visibility': 'Visibility',
      'competitive': 'Competitive',
      'talentx': 'TalentX'
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
    <div className="space-y-3 sm:space-y-4">
      {prompts.map((prompt) => (
        <div key={prompt.id} className="border border-gray-200 rounded-lg p-3 sm:p-4 bg-gray-50">
          <div className="space-y-2 sm:space-y-3">
            <Badge className={`${getCategoryColor(prompt.type)} w-fit text-xs sm:text-sm`}>
              {getTypeLabel(prompt.type)}
            </Badge>
            <div>
              <p className="text-xs sm:text-sm text-gray-900 font-medium leading-relaxed">
                {prompt.text}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
