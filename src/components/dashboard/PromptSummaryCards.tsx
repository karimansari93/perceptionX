import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PromptData, PromptResponse } from "@/types/dashboard";
import LLMLogo from "@/components/LLMLogo";
import { getLLMDisplayName } from "@/config/llmLogos";

interface PromptSummaryCardsProps {
  promptsData: PromptData[];
  responses: PromptResponse[];
}

function getUniqueLLMsForType(responses: PromptResponse[], type: string) {
  const models = new Set<string>();
  responses.forEach(r => {
    if (r.confirmed_prompts?.prompt_type === type && r.ai_model) {
      models.add(r.ai_model);
    }
  });
  return Array.from(models);
}

export const PromptSummaryCards = ({ promptsData, responses }: PromptSummaryCardsProps) => {
  const sentimentPrompts = promptsData.filter(p => p.type === 'sentiment' || p.type === 'talentx_sentiment');
  const visibilityPrompts = promptsData.filter(p => p.type === 'visibility' || p.type === 'talentx_visibility');
  const competitivePrompts = promptsData.filter(p => p.type === 'competitive' || p.type === 'talentx_competitive');

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-[#13274F]">Sentiment Prompts</CardTitle>
          <Badge className="bg-blue-100 text-blue-800">Sentiment</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{sentimentPrompts.length}</div>
          <p className="text-xs text-muted-foreground">
            Company-specific perception tracking
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-[#13274F]">Visibility Prompts</CardTitle>
          <Badge className="bg-green-100 text-green-800">Visibility</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{visibilityPrompts.length}</div>
          <p className="text-xs text-muted-foreground">
            Industry-wide mention tracking
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-[#13274F]">Competitive Prompts</CardTitle>
          <Badge className="bg-purple-100 text-purple-800">Competitive</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{competitivePrompts.length}</div>
          <p className="text-xs text-muted-foreground">
            Direct competitor comparisons
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
