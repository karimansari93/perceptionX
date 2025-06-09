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
    if (process.env.NODE_ENV === 'development') {
      console.log('Prompt clicked:', promptText);
    }
    
    // Find the matching responses for this exact prompt text
    const matchingResponses = responses.filter(r => {
      const matches = r.confirmed_prompts?.prompt_text === promptText;
      if (process.env.NODE_ENV === 'development') {
        console.log('Response matches:', matches);
      }
      return matches;
    });
    
    setSelectedPrompt(promptText);
    setIsModalOpen(true);
  };

  const getPromptResponses = (promptText: string) => {
    const matchingResponses = responses.filter(r => r.confirmed_prompts?.prompt_text === promptText);
    if (process.env.NODE_ENV === 'development') {
      console.log('Found responses for prompt:', matchingResponses.length);
    }
    return matchingResponses;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <PromptSummaryCards promptsData={promptsData} responses={responses} />

      {/* Single Combined Table */}
      <PromptTable
        prompts={promptsData}
        title="All Prompts"
        description="Monitor and analyze all your prompts in one place"
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
        promptsData={promptsData}
      />
    </div>
  );
};
