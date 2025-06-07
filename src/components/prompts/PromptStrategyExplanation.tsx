import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const PromptStrategyExplanation = () => {
  return (
    <Card className="mt-6 bg-gray-50 border-gray-200">
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold mb-4">How it works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <Badge className="bg-blue-100 text-blue-800 mb-2">Sentiment</Badge>
            <p className="text-sm text-gray-600">
              Brand-specific prompts that measure general sentiment about your company  , with balanced perspectives.
            </p>
          </div>
          <div>
            <Badge className="bg-green-100 text-green-800 mb-2">Visibility</Badge>
            <p className="text-sm text-gray-600">
              Industry-wide prompts that track how often your company is mentioned compared to competitors.
            </p>
          </div>
          <div>
            <Badge className="bg-purple-100 text-purple-800 mb-2">Competitive</Badge>
            <p className="text-sm text-gray-600">
              Direct comparison prompts that analyze your position relative to specific competitors.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
