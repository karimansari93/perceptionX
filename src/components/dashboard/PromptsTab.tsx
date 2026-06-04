import { useMemo, useCallback, memo } from "react";
import { PromptData } from "@/types/dashboard";
import { ResponseDetailsModal } from "./ResponseDetailsModal";
import { PromptResponse } from "@/types/dashboard";
import { PromptTable } from "./PromptTable";
import { ScrollablePills } from "./ScrollablePills";
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
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
}

export const PromptsTab = memo(({
  promptsData,
  responses,
  companyName = 'your company',
  onRefreshPrompts,
  isRefreshing,
  refreshProgress,
  responseTexts,
  fetchResponseTexts,
  selectedJobFunction = 'all',
  onJobFunctionChange,
}: PromptsTabProps) => {
  // Modal state - persisted
  const [selectedPrompt, setSelectedPrompt] = usePersistedState<string | null>('promptsTab.selectedPrompt', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('promptsTab.isModalOpen', false);

  // Pre-index responses by prompt text for O(1) lookup instead of O(n) filter
  const responsesByPrompt = useMemo(() => {
    const map = new Map<string, PromptResponse[]>();
    responses.forEach(r => {
      const text = r.confirmed_prompts?.prompt_text;
      if (text) {
        if (!map.has(text)) map.set(text, []);
        map.get(text)!.push(r);
      }
    });
    return map;
  }, [responses]);

  const handlePromptClick = useCallback((promptText: string) => {
    setSelectedPrompt(promptText);
    setIsModalOpen(true);
  }, []);

  const getPromptResponses = useCallback((promptText: string) => {
    return responsesByPrompt.get(promptText) || [];
  }, [responsesByPrompt]);

  const existingJobFunctions = useMemo(() => {
    const functions = new Set<string>();
    promptsData.forEach(p => {
      if (p.jobFunctionContext) functions.add(p.jobFunctionContext);
    });
    return Array.from(functions).sort((a, b) => a.localeCompare(b));
  }, [promptsData]);

  // Filter the table by the shared job-function pill selection (matches Overview/Sources/Competitors)
  const filteredPromptsData = useMemo(() => {
    if (!selectedJobFunction || selectedJobFunction === 'all') return promptsData;
    return promptsData.filter(p => (p.jobFunctionContext || '').trim() === selectedJobFunction);
  }, [promptsData, selectedJobFunction]);

  return (
    <div className="space-y-6 min-w-0 max-w-full overflow-hidden">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Prompts</h2>
        <p className="text-gray-600">
          Monitor and analyze {companyName}'s prompt performance across different AI models and track response quality.
        </p>
      </div>

      {/* Job function filter — shared with Overview, Sources, Competitors */}
      {existingJobFunctions.length > 0 && (
        <div className="sticky top-0 z-10 bg-white pb-2">
          <ScrollablePills
            selected={selectedJobFunction}
            onSelect={onJobFunctionChange ?? (() => {})}
            options={[
              { value: 'all', label: 'All functions' },
              ...existingJobFunctions.map((fn) => ({ value: fn, label: fn })),
            ]}
          />
        </div>
      )}

      {/* Single Combined Table */}
      <PromptTable
        prompts={filteredPromptsData}
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
          responseTexts={responseTexts}
          fetchResponseTexts={fetchResponseTexts}
        />
      )}
    </div>
  );
});
PromptsTab.displayName = 'PromptsTab';
