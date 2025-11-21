import React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ChevronRight, Wrench } from "lucide-react";
import { LastUpdated } from "./LastUpdated";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { CompanySwitcher } from "./CompanySwitcher";
import { LocationFilter } from "./LocationFilter";
import type { RefreshProgress } from "@/hooks/useRefreshPrompts";

interface DashboardHeaderProps {
  companyName: string;
  responsesCount: number;
  onRefresh: () => Promise<void>;
  breadcrumbs?: { label: string; icon?: React.ReactNode; active: boolean }[];
  lastUpdated?: Date;
  onFixData?: () => Promise<void>;
  hasDataIssues?: boolean;
  showAddCompanyModal?: boolean;
  setShowAddCompanyModal?: (show: boolean) => void;
  showUpgradeModal?: boolean;
  setShowUpgradeModal?: (show: boolean) => void;
  alwaysMounted?: boolean;
  isRefreshing?: boolean;
  refreshProgress?: RefreshProgress | null;
  selectedLocation?: string | null;
  onLocationChange?: (location: string | null) => void;
  onAddLocation?: () => void;
}

export const DashboardHeader = React.memo(({
  companyName,
  responsesCount,
  onRefresh,
  breadcrumbs,
  lastUpdated,
  onFixData,
  hasDataIssues,
  showAddCompanyModal,
  setShowAddCompanyModal,
  showUpgradeModal,
  setShowUpgradeModal,
  alwaysMounted,
  isRefreshing,
  refreshProgress,
  selectedLocation,
  onLocationChange,
  onAddLocation,
}: DashboardHeaderProps) => {
  const isMobile = useIsMobile();

  return (
    <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50">
      <div className="flex items-center h-16 px-4 sm:px-8">
        {/* SidebarTrigger first, then breadcrumbs */}
        <SidebarTrigger className="h-7 w-7 mr-4 text-[#13274F]" />
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              {breadcrumbs[0].icon && (
                <span className="text-gray-500">{breadcrumbs[0].icon}</span>
              )}
              <span className={`text-base font-light hidden sm:inline ${breadcrumbs[0].active ? "text-gray-700" : "text-gray-500"}`}>{breadcrumbs[0].label}</span>
            </span>
            {/* Render the rest of the breadcrumbs on desktop only */}
            {!isMobile && breadcrumbs.slice(1).map((crumb, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <ChevronRight className="w-5 h-5 text-[#13274F] mx-1" />
                <span className={`text-base font-medium ${crumb.active ? "text-gray-700" : "text-gray-500"}`}>{crumb.label}</span>
              </span>
            ))}
          </div>
        )}
        {/* Right side with LocationFilter, CompanySwitcher, LastUpdated component and debug button */}
        <div className="flex-1" />
        <div className="flex items-center gap-2 sm:gap-3">
          {onLocationChange && (
            <LocationFilter 
              selectedLocation={selectedLocation || null}
              onLocationChange={onLocationChange}
              onAddLocation={onAddLocation}
              className={isMobile ? "min-w-[120px]" : ""}
            />
          )}
          <CompanySwitcher 
            variant="outline" 
            showAddCompanyModal={showAddCompanyModal} 
            setShowAddCompanyModal={setShowAddCompanyModal} 
            showUpgradeModal={showUpgradeModal} 
            setShowUpgradeModal={setShowUpgradeModal} 
            alwaysMounted={alwaysMounted}
            locationFilter={selectedLocation || undefined}
            className={isMobile ? "min-w-[120px] text-xs" : ""}
          />
          {hasDataIssues && onFixData && (
            <Button
              variant="outline"
              size="sm"
              onClick={onFixData}
              className="text-orange-600 border-orange-200 hover:bg-orange-50"
            >
              <Wrench className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Fix Data Issues</span>
              <span className="sm:hidden">Fix</span>
            </Button>
          )}
          <LastUpdated onRefresh={onRefresh} lastUpdated={lastUpdated} />
        </div>
      </div>
      {isRefreshing && refreshProgress && (
        <div className="px-4 sm:px-8 py-2 text-sm text-blue-700 bg-blue-50 border-t border-blue-100">
          Collecting responses: {refreshProgress.completed}/{refreshProgress.total} operations…
        </div>
      )}
    </header>
  );
});

DashboardHeader.displayName = 'DashboardHeader';
