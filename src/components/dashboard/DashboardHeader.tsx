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
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={isRefreshing} variant="outline" size="sm" className="flex items-center space-x-2 bg-white/80">
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleRefresh()}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh All Models
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRefresh('openai')}>
                  <LLMLogo modelName="openai" size="sm" className="mr-2" />
                  Refresh OpenAI Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRefresh('perplexity')}>
                  <LLMLogo modelName="perplexity" size="sm" className="mr-2" />
                  Refresh Perplexity Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRefresh('gemini')}>
                  <LLMLogo modelName="gemini" size="sm" className="mr-2" />
                  Refresh Gemini Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRefresh('deepseek')}>
                  <LLMLogo modelName="deepseek" size="sm" className="mr-2" />
                  Refresh DeepSeek Only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <Badge className="bg-green-100/80 text-green-800 border-green-200">
              {responsesCount} responses tracked
            </Badge>
          </div>
        </div>
        
        {/* Progress indicator */}
        {isRefreshing && progress && (
          <div className="mt-4 bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-primary">Refreshing AI Responses</span>
              </div>
              <span className="text-sm text-primary/70">
                {progress.completed} / {progress.total}
              </span>
            </div>
            <div className="w-full bg-primary/20 rounded-full h-2 mb-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-300" 
                style={{ width: `${progress.completed / progress.total * 100}%` }}
              ></div>
            </div>
            <div className="text-xs text-primary/70">
              <div>Testing: {progress.currentPrompt}</div>
              <div>Model: {progress.currentModel}</div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
