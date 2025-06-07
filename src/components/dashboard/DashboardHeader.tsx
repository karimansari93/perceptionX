import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RefreshCw, ChevronDown } from "lucide-react";
import LLMLogo from "@/components/LLMLogo";
import { useRefreshPrompts } from "@/hooks/useRefreshPrompts";

interface DashboardHeaderProps {
  companyName: string;
  responsesCount: number;
  onRefresh: () => Promise<void>;
}

export const DashboardHeader = ({
  companyName,
  responsesCount,
  onRefresh
}: DashboardHeaderProps) => {
  const {
    isRefreshing,
    progress,
    refreshAllPrompts
  } = useRefreshPrompts();

  const handleRefresh = async (modelType?: string) => {
    if (!companyName) return;
    await refreshAllPrompts(companyName, modelType);
    await onRefresh();
  };

  return (
    <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50">
      <div className="px-6 py-4">
        <div className="flex items-center justify-end">
          <div className="flex flex-row items-center gap-3 flex-nowrap">
            <div className="flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
              <LLMLogo modelName="openai" size="sm" className="mr-1" />
              <span className="text-sm text-gray-700">OpenAI</span>
            </div>
            <div className="flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
              <LLMLogo modelName="perplexity" size="sm" className="mr-1" />
              <span className="text-sm text-gray-700">Perplexity</span>
            </div>
            <div className="flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
              <LLMLogo modelName="gemini" size="sm" className="mr-1" />
              <span className="text-sm text-gray-700">Gemini</span>
            </div>
            <div className="flex items-center bg-gray-100/80 px-2 py-1 rounded-lg">
              <LLMLogo modelName="deepseek" size="sm" className="mr-1" />
              <span className="text-sm text-gray-700">DeepSeek</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
