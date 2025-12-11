import { useState } from "react";
import { PromptData } from "@/types/dashboard";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { PromptResponse } from "@/types/dashboard";
import { PromptTable } from "./PromptTable";
import { UpgradeBanner } from "./UpgradeBanner";
import { useSubscription } from "@/hooks/useSubscription";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { AddIndustryPromptModal } from "./AddIndustryPromptModal";
import type { RefreshProgress } from "@/hooks/useRefreshPrompts";
import { usePersistedState } from "@/hooks/usePersistedState";

interface PromptsTabProps {
  promptsData: PromptData[];
  responses: PromptResponse[];
  companyName?: string;
  onRefresh?: () => void;
  onRefreshPrompts: (promptIds: string[], companyName: string) => Promise<void>;
  isRefreshing: boolean;
  refreshProgress: RefreshProgress | null;
  selectedLocation?: string | null;
}

export const PromptsTab = ({
  promptsData,
  responses,
  companyName = 'your company',
  onRefresh,
  onRefreshPrompts,
  isRefreshing,
  refreshProgress,
  selectedLocation,
}: PromptsTabProps) => {
  // Modal states - persisted
  const [selectedPrompt, setSelectedPrompt] = usePersistedState<string | null>('promptsTab.selectedPrompt', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('promptsTab.isModalOpen', false);
  const [isAddPromptModalOpen, setIsAddPromptModalOpen] = usePersistedState<boolean>('promptsTab.isAddPromptModalOpen', false);
  const { isPro } = useSubscription();
  const { currentCompany } = useCompany();

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

  // Calculate current vs total prompts
  const currentPrompts = promptsData.length;
  const totalPrompts = 33; // 33 total prompts available (3 base + 30 Employee/Candidate Experience prompts)

  const existingIndustries = (currentCompany?.industries && currentCompany.industries.length > 0)
    ? currentCompany.industries
    : (currentCompany?.industry ? [currentCompany.industry] : []);

  const handlePromptsAdded = () => {
    onRefresh?.();
  };

  return (
    <>
      <div className="space-y-6">
        {/* Main Section Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-gray-900">Prompts</h2>
            <p className="text-gray-600">
              Monitor and analyze {companyName}'s prompt performance across different AI models and track response quality.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setIsAddPromptModalOpen(true)}
            disabled={!currentCompany}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add new prompt
          </Button>
        </div>

        {/* Upgrade Banner - Only show for non-Pro users */}
        {!isPro && (
          <UpgradeBanner
            currentPrompts={currentPrompts}
            totalPrompts={totalPrompts}
            companyName={companyName}
          />
        )}

        {/* Single Combined Table */}
        <PromptTable
          prompts={promptsData}
          onPromptClick={handlePromptClick}
        />

        {/* Response Details Modal */}
        {selectedPrompt && (
          <ResponseDetailsModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              // Keep selectedPrompt so it can be restored
            }}
            promptText={selectedPrompt}
            responses={getPromptResponses(selectedPrompt)}
            promptsData={promptsData}
            companyName={companyName}
            onRefreshPrompt={onRefreshPrompts}
            isRefreshing={isRefreshing}
            refreshProgress={refreshProgress}
          />
        )}
      </div>

      {currentCompany && (
        <AddIndustryPromptModal
          isOpen={isAddPromptModalOpen}
          onClose={() => setIsAddPromptModalOpen(false)}
          companyId={currentCompany.id}
          companyName={companyName}
          existingIndustries={existingIndustries}
          onPromptsAdded={handlePromptsAdded}
          onRefreshPrompts={onRefreshPrompts}
          isRefreshing={isRefreshing}
          refreshProgress={refreshProgress}
          selectedLocation={selectedLocation}
        />
      )}
    </>
  );
};
