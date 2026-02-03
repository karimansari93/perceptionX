import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PromptData, PromptResponse } from "@/types/dashboard";
import LLMLogo from "@/components/LLMLogo";
import { getLLMDisplayName } from "@/config/llmLogos";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const experiencePrompts = promptsData.filter(p => p.type === 'experience' || p.type === 'talentx_experience');
  const discoveryPrompts = promptsData.filter(p => p.type === 'discovery' || p.type === 'talentx_discovery');
  const competitivePrompts = promptsData.filter(p => p.type === 'competitive' || p.type === 'talentx_competitive');
  const informationalPrompts = promptsData.filter(p => p.type === 'informational' || p.type === 'talentx_informational');

  // Hide all cards on mobile
  if (isMobile) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-[#13274F]">Experience Prompts</CardTitle>
          <Badge className="bg-blue-100 text-blue-800">Experience</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{experiencePrompts.length}</div>
          <p className="text-xs text-muted-foreground">
            What it&apos;s like to work there
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-[#13274F]">Discovery Prompts</CardTitle>
          <Badge className="bg-green-100 text-green-800">Discovery</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{discoveryPrompts.length}</div>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-[#13274F]">Informational Prompts</CardTitle>
          <Badge className="bg-amber-100 text-amber-800">Informational</Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{informationalPrompts.length}</div>
          <p className="text-xs text-muted-foreground">
            Job and offer details
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
