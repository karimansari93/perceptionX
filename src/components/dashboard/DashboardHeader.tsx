import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RefreshCw, ChevronDown } from "lucide-react";
import { useRefreshPrompts } from "@/hooks/useRefreshPrompts";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ChevronRight } from "lucide-react";

interface DashboardHeaderProps {
  companyName: string;
  responsesCount: number;
  onRefresh: () => Promise<void>;
  breadcrumbs?: { label: string; icon?: any; active: boolean }[];
}

export const DashboardHeader = ({
  companyName,
  responsesCount,
  onRefresh,
  breadcrumbs
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
      <div className="flex items-center h-16 px-8">
        {/* SidebarTrigger first, then breadcrumbs, then space */}
        <SidebarTrigger className="h-7 w-7 mr-4" />
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className={`text-base font-light ${breadcrumbs[0].active ? "text-gray-700" : "text-gray-500"}`}>{breadcrumbs[0].label}</span>
            </span>
            {/* Render the rest of the breadcrumbs, if any */}
            {breadcrumbs.slice(1).map((crumb, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <ChevronRight className="w-5 h-5 text-gray-400 mx-1" />
                <span className={`text-base font-medium ${crumb.active ? "text-gray-700" : "text-gray-500"}`}>{crumb.label}</span>
              </span>
            ))}
          </div>
        )}
        {/* Right side empty for now */}
        <div className="flex-1" />
      </div>
    </header>
  );
};
