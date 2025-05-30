import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface OnboardingData {
  companyName: string;
  industry: string;
}

interface OnboardingDataSummaryProps {
  onboardingData: OnboardingData;
}

export const OnboardingDataSummary = ({ onboardingData }: OnboardingDataSummaryProps) => {
  return (
    <Card className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
      <CardContent className="p-6">
        <h2 className="text-xl font-semibold text-blue-900 mb-3">
          Enhanced Prompt Strategy for {onboardingData.companyName}
        </h2>
        <p className="text-blue-700 mb-4">
          We've created a comprehensive monitoring strategy with three types of prompts: sentiment tracking, visibility monitoring, and competitive analysis.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <Badge variant="secondary" className="mr-2">Industry:</Badge>
            {onboardingData.industry}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
