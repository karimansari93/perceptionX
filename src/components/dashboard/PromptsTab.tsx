import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PromptData } from "@/types/dashboard";
import { MessageSquare } from "lucide-react";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { PromptResponse } from "@/types/dashboard";
import { PromptSummaryCards } from "./PromptSummaryCards";
import { PromptTable } from "./PromptTable";

interface PromptsTabProps {
  promptsData: PromptData[];
  responses: PromptResponse[];
}

export const PromptsTab = ({ promptsData, responses }: PromptsTabProps) => {
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handlePromptClick = (promptText: string) => {
    console.log('Prompt clicked:', promptText);
    console.log('All responses:', responses);
    
    // Find the matching responses for this exact prompt text
    const matchingResponses = responses.filter(r => {
      const matches = r.confirmed_prompts?.prompt_text === promptText;
      console.log('Response prompt text:', r.confirmed_prompts?.prompt_text);
      console.log('Clicked prompt text:', promptText);
      console.log('Matches:', matches);
      return matches;
    });
    
    console.log('Filtered matching responses:', matchingResponses);
    
    setSelectedPrompt(promptText);
    setIsModalOpen(true);
  };

  const getPromptResponses = (promptText: string) => {
    const matchingResponses = responses.filter(r => r.confirmed_prompts?.prompt_text === promptText);
    console.log('getPromptResponses called for:', promptText);
    console.log('Found responses:', matchingResponses);
    return matchingResponses;
  };

  const sentimentPrompts = promptsData.filter(p => p.type === 'sentiment');
  const visibilityPrompts = promptsData.filter(p => p.type === 'visibility');
  const competitivePrompts = promptsData.filter(p => p.type === 'competitive');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <PromptSummaryCards promptsData={promptsData} />

      {/* Detailed Tables */}
      <PromptTable
        prompts={sentimentPrompts}
        title="Sentiment Tracking Prompts"
        description="Monitor how AI models perceive your company with balanced, nuanced questions"
        onPromptClick={handlePromptClick}
      />

      <PromptTable
        prompts={visibilityPrompts}
        title="Visibility Monitoring Prompts"
        description="Track how often your company appears in industry-wide AI responses"
        onPromptClick={handlePromptClick}
      />

      <PromptTable
        prompts={competitivePrompts}
        title="Competitive Analysis Prompts"
        description="Compare your company directly against specific competitors"
        onPromptClick={handlePromptClick}
      />

      {promptsData.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Prompts Found</h3>
            <p className="text-gray-600">
              Start monitoring to see your prompts and their performance here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Response Details Modal */}
      <ResponseDetailsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        promptText={selectedPrompt || ""}
        responses={selectedPrompt ? getPromptResponses(selectedPrompt) : []}
      />
    </div>
  );
};
