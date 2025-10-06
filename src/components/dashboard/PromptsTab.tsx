import { useState, useEffect } from "react";
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
  companyName?: string;
}

export const PromptsTab = ({ promptsData, responses, companyName = 'your company' }: PromptsTabProps) => {
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);



  const handlePromptClick = (promptText: string) => {
    // Find the matching responses for this exact prompt text
    const matchingResponses = responses.filter(r => {
      return r.confirmed_prompts?.prompt_text === promptText;
    });
    
    setSelectedPrompt(promptText);
    setIsModalOpen(true);
  };

  const getPromptResponses = (promptText: string) => {
    const matchingResponses = responses.filter(r => r.confirmed_prompts?.prompt_text === promptText);
    return matchingResponses;
  };

  return (
    <div className="space-y-6">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Prompts</h2>
        <p className="text-gray-600">
          Monitor and analyze {companyName}'s prompt performance across different AI models and track response quality.
        </p>
      </div>

      {/* Single Combined Table */}
      <PromptTable
        prompts={promptsData}
        onPromptClick={handlePromptClick}
      />

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
