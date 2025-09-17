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
}

export const PromptsTab = ({ promptsData, responses }: PromptsTabProps) => {
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
