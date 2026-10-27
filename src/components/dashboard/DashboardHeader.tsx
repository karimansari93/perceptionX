import React, { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ChevronRight, Search, SlidersHorizontal, Wrench } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GENERAL_KEY } from "@/utils/locationContext";
import { SEARCH_SHORTCUT } from "@/lib/searchShortcut";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { CompanySwitcher } from "./CompanySwitcher";
import { LocationFilter } from "./LocationFilter";
import { JobFunctionFilter } from "./JobFunctionFilter";
import { PeriodInfo } from "@/hooks/useDashboardData";
import { StarSavedView } from "./StarSavedView";
import { LocationEntry } from "@/utils/locationContext";

interface DashboardHeaderProps {
  companyName: string;
  responsesCount: number;
  breadcrumbs?: { label: string; icon?: React.ReactNode; active: boolean }[];
  onFixData?: () => Promise<void>;
  hasDataIssues?: boolean;
  alwaysMounted?: boolean;
  selectedLocation?: string | null;
  onLocationChange?: (location: string | null) => void;
  onPendingLocationChange?: (location: string | null) => void;
  locationOptions?: LocationEntry[];
  // Period props are accepted but unused: the view is always the latest
  // measured period.
  availablePeriods?: PeriodInfo[];
  selectedPeriod?: string | null;
  onPeriodChange?: (period: string | null) => void;
  // Job-function filter (owned by the Dashboard, shared by every tab).
  jobFunctionOptions?: string[];
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
  userId?: string | null;
  companyId?: string | null;
  // Intent prefetch for the two switchers (see useDashboardData).
  onLocationPrefetch?: (locationKey: string) => void;
  onCompanyPrefetch?: (companyId: string) => void;
  /** Opens the global command palette (⌘K / Ctrl+K search). */
  onOpenSearch?: () => void;
}

export const DashboardHeader = React.memo(({
  companyName,
  responsesCount,
  breadcrumbs,
  onFixData,
  hasDataIssues,
  alwaysMounted,
  selectedLocation,
  onLocationChange,
  onPendingLocationChange,
  locationOptions,
  availablePeriods,
  selectedPeriod,
  onPeriodChange,
  jobFunctionOptions,
  selectedJobFunction,
  onJobFunctionChange,
  userId,
  companyId,
  onLocationPrefetch,
  onCompanyPrefetch,
  onOpenSearch,
}: DashboardHeaderProps) => {
  const isMobile = useIsMobile();
  const compact = useCompactHeader();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The filters, in a row on wider screens and stacked full width in the
  // phone's Filters panel. Same controls either way.
  const filterControls = (stacked: boolean) => {
    const field = (label: string, tour: string, control: React.ReactNode) => stacked ? (
      <div data-tour={tour} className="space-y-1.5">
        <div className="text-xs font-medium text-gray-500">{label}</div>
        <div className="[&>*]:w-full">{control}</div>
      </div>
    ) : (
      <div data-tour={tour}>{control}</div>
    );
    return (
      <>
        {stacked && field('Company', 'company-switcher', (
          <CompanySwitcher
            variant="outline"
            alwaysMounted={alwaysMounted}
            onPendingLocationChange={onPendingLocationChange}
            onIntentPrefetch={onCompanyPrefetch}
            className="w-full"
          />
        ))}
        {/* No period selector: the dashboard always shows the latest
            measured period (customers want the current data). */}
        {onLocationChange && field('Market', 'location-filter', (
          <LocationFilter
            selectedLocation={selectedLocation || null}
            onLocationChange={onLocationChange}
            options={locationOptions}
            onIntentPrefetch={onLocationPrefetch}
            className={stacked ? "w-full" : ""}
          />
        ))}
        {onJobFunctionChange && jobFunctionOptions && jobFunctionOptions.length > 0 && field('Job function', 'job-function-filter', (
          <JobFunctionFilter
            options={jobFunctionOptions}
            selected={selectedJobFunction ?? 'all'}
            onChange={onJobFunctionChange}
            className={stacked ? "w-full max-w-none" : ""}
          />
        ))}
        {onLocationChange && (stacked ? (
          <div data-tour="saved-view" className="flex items-center gap-2 text-sm text-gray-600">
            <StarSavedView
              userId={userId}
              companyId={companyId}
              currentLocation={selectedLocation ?? null}
              currentPeriod={selectedPeriod ?? null}
            />
            Save this view
          </div>
        ) : (
          <div data-tour="saved-view">
            <StarSavedView
              userId={userId}
              companyId={companyId}
              currentLocation={selectedLocation ?? null}
              currentPeriod={selectedPeriod ?? null}
            />
          </div>
        ))}
        {!stacked && (
          <div data-tour="company-switcher">
            <CompanySwitcher
              variant="outline"
              alwaysMounted={alwaysMounted}
              onPendingLocationChange={onPendingLocationChange}
              onIntentPrefetch={onCompanyPrefetch}
            />
          </div>
        )}
        {hasDataIssues && onFixData && (
          <Button
            variant="outline"
            size="sm"
            onClick={onFixData}
            className="text-orange-600 border-orange-200 hover:bg-orange-50"
          >
            <Wrench className="w-4 h-4 mr-2" />
            Fix Data Issues
          </Button>
        )}
      </>
    );
  };

  // Below laptop width: one row (page title, search, Filters, plus the
  // menu on phones); the filters open in a panel from the bottom, with a dot
  // while a market or function is set.
  if (compact) {
    const title = breadcrumbs?.[breadcrumbs.length - 1]?.label;
    const filtered = (!!selectedLocation && selectedLocation !== GENERAL_KEY) || (!!selectedJobFunction && selectedJobFunction !== 'all');
    const iconButton = 'relative flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-[#13274F] transition-colors hover:bg-gray-50';
    return (
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50">
        <div className="flex items-center h-16 gap-2 px-4">
          {isMobile && <SidebarTrigger className="h-7 w-7 mr-1 text-[#13274F]" />}
          <span className="min-w-0 flex-1 truncate text-base font-medium text-gray-700">{title}</span>
          {onOpenSearch && (
            <button type="button" onClick={onOpenSearch} aria-label="Search" className={iconButton}>
              <Search className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => setFiltersOpen(true)} aria-label="Filters" className={iconButton}>
            <SlidersHorizontal className="h-4 w-4" />
            {filtered && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#DB5E89] ring-2 ring-white" />}
          </button>
        </div>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl px-4 pb-6 pt-5">
            <SheetTitle className="mb-4 text-base">Filters</SheetTitle>
            <div className="space-y-4">{filterControls(true)}</div>
          </SheetContent>
        </Sheet>
      </header>
    );
  }

  return (
    <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50">
      <div className="flex items-center h-16 px-4 sm:px-8">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              {breadcrumbs[0].icon && (
                <span className="text-gray-500">{breadcrumbs[0].icon}</span>
              )}
              <span className={`text-base font-light hidden sm:inline ${breadcrumbs[0].active ? "text-gray-700" : "text-gray-500"}`}>{breadcrumbs[0].label}</span>
            </span>
            {breadcrumbs.slice(1).map((crumb, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <ChevronRight className="w-5 h-5 text-[#13274F] mx-1" />
                <span className={`text-base font-medium ${crumb.active ? "text-gray-700" : "text-gray-500"}`}>{crumb.label}</span>
              </span>
            ))}
          </div>
        )}
        {/* Search in the top bar (after Zoom's), between the breadcrumb and the filters. */}
        <div className="flex flex-1 justify-center px-4">
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex w-full max-w-[320px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:bg-white"
            >
              <Search className="h-4 w-4 text-gray-400" />
              <span className="flex-1 text-left">Search</span>
              <kbd className="pointer-events-none inline-flex items-center rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                {SEARCH_SHORTCUT}
              </kbd>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {filterControls(false)}
        </div>
      </div>
    </header>
  );
});

DashboardHeader.displayName = 'DashboardHeader';

// The header's filters only fit in a row from the lg breakpoint (1024px).
const COMPACT_QUERY = '(max-width: 1023px)';

function useCompactHeader(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(COMPACT_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return compact;
}
