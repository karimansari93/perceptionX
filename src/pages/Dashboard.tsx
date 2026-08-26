import { useState, useEffect, useMemo, useRef, useCallback, startTransition } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { CustomReports } from "@/components/dashboard/CustomReports";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/dashboard/CommandPalette";
import { TabSearchSeedProvider } from "@/contexts/TabSearchSeedContext";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronRight, LayoutDashboard, Lock, Globe, Users, TrendingUp, BarChart3, Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetworkStatus } from "@/components/NetworkStatus";
import { 
  OverviewSkeleton,
  PromptsSkeleton,
  ReportsSkeleton,
  SourcesSkeleton,
  CompetitorsSkeleton,
  ThematicSkeleton,
  SearchSkeleton
} from "@/components/dashboard/SectionSkeletons";

// OverviewTab is eagerly imported — it's the default landing tab
import { OverviewTab } from "@/components/dashboard/OverviewTab";

// All other tabs are lazy-loaded — mounted on first visit, then kept alive
const SourcesTab = lazyWithRetry(() => import("@/components/dashboard/SourcesTab").then(module => ({ default: module.SourcesTab })));
const CompetitorsTab = lazyWithRetry(() => import("@/components/dashboard/CompetitorsTab").then(module => ({ default: module.CompetitorsTab })));
const ThematicAnalysisTab = lazyWithRetry(() => import("@/components/dashboard/ThematicAnalysisTab").then(module => ({ default: module.ThematicAnalysisTab })));
const PromptsTab = lazyWithRetry(() => import("@/components/dashboard/PromptsTab").then(module => ({ default: module.PromptsTab })));
import LLMLogo from "@/components/LLMLogo";
import { useRefreshPrompts } from "@/hooks/useRefreshPrompts";
import { LoadingScreen, useLoadingHandoff } from "@/components/ui/loading-screen";
import { useCompanyDataCollection } from "@/hooks/useCompanyDataCollection";
import { usePersistedState } from "@/hooks/usePersistedState";
import { GENERAL_KEY } from "@/utils/locationContext";
import { quarterKeyOfMonthStr } from "@/utils/quarterKey";
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  sources: "Sources",
  competitors: "Competitors",
  thematic: "Themes",
  prompts: "Prompts",
  reports: "Reports",
};

interface DatabaseOnboardingData {
  company_name: string;
  industry: string;
  user_id?: string;
  session_id?: string;
  created_at?: string;
  id?: string;
}

const DashboardContent = ({ defaultGroup, defaultSection }: DashboardProps = {}) => {
  const { user } = useAuth();
  const { currentCompany, loading: companyLoading } = useCompany();
  // Persist initial load state so we don't show loading screen on every navigation
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = usePersistedState<boolean>('dashboard.hasInitiallyLoaded', false);
  const [activeTab, setActiveTab] = useState<'terms' | 'results'>('results');
  const [chartView, setChartView] = useState<'bubble' | 'bar'>('bubble');
  // Track which lazy tabs have been visited so they stay mounted after first
  // visit. Deliberately NOT reset on company switch: every tab's company-
  // scoped data arrives via props or effects keyed on currentCompanyId,
  // so mounted tabs re-render with the new
  // scope's data — a reset would cold-remount all of them on every switch.
  const [hasVisited, setHasVisited] = useState({
    sources: false,
    competitors: false,
    thematic: false,
    prompts: false,
    search: false,
  });
  const { isRefreshing, progress: refreshProgress, refreshAllPrompts } = useRefreshPrompts();
  const { 
    isCollecting: isCollectingData, 
    collectionStatus, 
    progress: collectionProgress, 
    resumeCollection 
  } = useCompanyDataCollection();

  // Set chart view based on screen size - 'bar' on mobile, 'bubble' (SWOT) on desktop
  useEffect(() => {
    const checkScreenSize = () => {
      const isMobile = window.innerWidth < 768; // md breakpoint
      setChartView(isMobile ? 'bar' : 'bubble');
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);

    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  const dashboardData = useDashboardData();
  const {
    responses,
    loading,
    competitorLoading,
    metricsLoading,
    isFullyLoaded,
    companyName,
    metrics,
    metricsByJobFunction,
    topCitations,
    promptsData,
    refreshData,
    parseCitations,
    topCompetitors,
    llmMentionRankings,
    fixExistingPrompts,
    hasDataIssues,
    aiThemes,
    fetchAIThemesForAttribute,
    aiThemeAttrsLoaded,
    attributeThemes,
    responseSentimentRows,
    isOnline,
    connectionError,
    recencyDataError,
    recencyData,
    recencyDataLoading,
    aiThemesLoading,
    metricsCalculating,
    responseTexts,
    fetchResponseTexts,
    availablePeriods,
    selectedPeriod,
    setSelectedPeriod,
    previousPeriodMetrics,
    companyRelevanceByMonth,
    previousPeriodResponses,
    epsTrend,
    epsChange,
    epsTrendByJobFunction,
    epsChangeByJobFunction,
    selectedLocation,
    setSelectedLocation,
    setPendingLocation,
    locationOptions,
    locationMetricsLoading,
    scopeCompanyIds,
    allResponses,
    responsesLoadedCompanyId,
    prefetchLocationRollups,
    prefetchCompanyRollups,
    hydration,
    scopeStats,
    domainStats,
    competitorStats,
    cubeScopeRows,
    cubePromptTypeRows,
    cubeDailyRows,
    cubeDailyUnsound,
    cubeQuarterKey,
    cubePrevQuarterKey,
    cubeMonthFloor,
    cubesLoading,
  } = dashboardData;

  // `isRefreshing` ships with the TanStack rewrite of useDashboardData (true
  // while a scope's queries revalidate in the background with data already
  // present). Read defensively — not destructured — so this file compiles
  // against both hook versions; named apart from useRefreshPrompts's
  // isRefreshing above, which tracks the prompt-refresh pipeline instead.
  const isDataRefreshing =
    (dashboardData as unknown as { isRefreshing?: boolean }).isRefreshing === true;

  // -----------------------------------------------------------------------
  // GLOBAL JOB-FUNCTION FILTER
  //
  // Shared across every dashboard tab (Overview, Sources, Competitors,
  // Themes) so a selection made on one tab carries over to the others instead
  // of silently resetting. Lifted here rather than kept per-tab because all
  // tabs stay mounted simultaneously (display:none) — a per-tab
  // usePersistedState never propagates a live change to an already-mounted
  // sibling, and each tab used its own storage key. Persisted so it survives
  // reloads; defaults to 'all' (All functions) until the user picks one.
  const [selectedJobFunction, setSelectedJobFunction] = usePersistedState<string>('dashboard.selectedJobFunction', 'all');

  // Selection changes fan out into every mounted tab at once (all visited
  // tabs stay alive under display:none), so an urgent setState would block
  // the click until the whole tree re-renders. Transition-wrapped setters
  // keep the control responsive; signatures are unchanged for consumers.
  // setPendingLocation is NOT wrapped: it stashes into a ref that the hook's
  // company-entry effect must see on the very next switch — nothing to defer.
  const handleJobFunctionChange = useCallback((value: string) => {
    startTransition(() => setSelectedJobFunction(value));
  }, [setSelectedJobFunction]);
  const handleLocationChange = useCallback((loc: string | null) => {
    startTransition(() => setSelectedLocation(loc));
  }, [setSelectedLocation]);
  const handlePeriodChange = useCallback((period: string | null) => {
    startTransition(() => setSelectedPeriod(period));
  }, [setSelectedPeriod]);

  // The set of job functions that exist ANYWHERE in the brand's data — judged
  // against the unfiltered `allResponses`, not the location/period-filtered
  // `responses`, so selecting a location where a function has no prompts leaves
  // it temporarily inapplicable instead of permanently wiping the saved pill.
  const availableJobFunctions = useMemo(() => {
    const fns = new Set<string>();
    allResponses.forEach(r => {
      const fn = r.confirmed_prompts?.job_function_context?.trim();
      if (fn) fns.add(fn);
    });
    return fns;
  }, [allResponses]);

  // Proper-case market name for the selected location (e.g. "United States",
  // "Burbank"), used for benchmark lookups. The benchmark MV keys on country
  // names; cities simply return no benchmark rows (handled gracefully).
  const selectedMarketName = useMemo(() => {
    if (!selectedLocation || selectedLocation === GENERAL_KEY) return null;
    return locationOptions?.find(o => o.canonicalKey === selectedLocation)?.label ?? null;
  }, [selectedLocation, locationOptions]);

  // Job-function vocabularies are company-specific: a function saved on one
  // company means nothing on another, and because the pill filter is shared
  // persisted state it used to survive a company switch INVISIBLY — no pill
  // matched (nothing looked selected) while every function-filtered card
  // rendered empty. Switching company resets the pill to 'all'. First mount
  // (prev === null) keeps the persisted selection for the company being
  // restored — the guards below validate it against real data.
  const prevPillCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    const id = currentCompany?.id ?? null;
    if (id && prevPillCompanyRef.current && prevPillCompanyRef.current !== id && selectedJobFunction !== 'all') {
      setSelectedJobFunction('all');
    }
    if (id) prevPillCompanyRef.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  // Function vocabulary of the CURRENT VIEW (company + location + period),
  // from the scope cube — available in ~250ms, long before the raw stream.
  // This mirrors exactly the pill list the tabs render, so the rule is
  // simple and visible: if the saved selection matches no pill on screen,
  // swap to "All functions". (Product decision: a filter that nothing on
  // screen can express must never silently empty the dashboard.)
  const cubeJobFunctions = useMemo(() => {
    if (!cubeScopeRows) return null; // cube not landed yet — don't judge
    const fns = new Set<string>();
    cubeScopeRows.forEach((r: any) => {
      if (cubeQuarterKey && (!r.response_month || quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey)) return;
      const fn = (r.job_function_context || '').trim();
      if (fn && (r.total_responses || 0) > 0) fns.add(fn);
    });
    return fns;
  }, [cubeScopeRows, cubeQuarterKey]);

  // GUARANTEE: never strand the dashboard in a no-data state. Fires as soon
  // as the scope cube lands (covers company switches, location switches,
  // period switches, and stale restored sessions alike); the stream-final
  // guard below remains as the fallback for scopes whose cube hasn't
  // backfilled yet.
  useEffect(() => {
    if (
      selectedJobFunction !== 'all' &&
      cubeJobFunctions !== null &&
      !cubeJobFunctions.has(selectedJobFunction)
    ) {
      setSelectedJobFunction('all');
    }
  }, [selectedJobFunction, cubeJobFunctions, setSelectedJobFunction]);
  useEffect(() => {
    if (
      selectedJobFunction !== 'all' &&
      responsesLoadedCompanyId === currentCompany?.id &&
      allResponses.length > 0 &&
      !availableJobFunctions.has(selectedJobFunction)
    ) {
      setSelectedJobFunction('all');
    }
  }, [selectedJobFunction, availableJobFunctions, allResponses.length, responsesLoadedCompanyId, currentCompany?.id, setSelectedJobFunction]);

  // Raw prompt_responses now stream in AFTER first paint (the headline
  // numbers are rollup-first). While the current company's stream hasn't
  // fully landed, raw-derived tabs render skeleton rows instead of "No data"
  // empty states. Keyed on responsesLoadedCompanyId — the one flag that means
  // "the raw set is FINAL" (all pages committed, loaded empty, or cache-
  // restored).
  const responsesStreaming = responsesLoadedCompanyId !== currentCompany?.id;

  // The starred view (location + period) is applied inside useDashboardData's
  // company-entry effect — same code path as pending sibling-switch locations,
  // so it can't clobber an explicit pick and gets the same loading-flag
  // discipline (no half-swapped paint).

  // Search insights feature retired — empty array preserved for components
  // that still accept a `searchResults` prop until those are stripped.
  const currentCompanySearchResults: any[] = [];
  const searchResults: any[] = [];
  const searchTermsData: any = null;

  const handleRefreshPrompts = useCallback(async (ids: string[], name?: string) => {
    const targetName = name || companyName || currentCompany?.name;
    if (!targetName || ids.length === 0) return;
    await refreshAllPrompts(targetName, {
      promptIds: ids,
      companyId: currentCompany?.id,
    });
  }, [companyName, currentCompany?.name, currentCompany?.id, refreshAllPrompts]);

  // Search insights retired — no fetch needed.


  const [activeSection, setActiveSection] = useState(defaultSection || "overview");
  const [activeGroup, setActiveGroup] = useState(defaultGroup || "dashboard");
  useDocumentTitle(SECTION_TITLES[activeSection]);
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();

  // Global command palette (⌘K / Ctrl+K) — a search launcher in the sidebar.
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCommandOpen(open => !open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Direct section → route navigation for the palette. Unlike handleSectionChange
  // (which is scoped to the current group), this can jump across groups.
  const navigateToSection = useCallback((section: string) => {
    const routes: Record<string, string> = {
      overview: '/dashboard',
      sources: '/dashboard/sources',
      competitors: '/dashboard/competitors',
      thematic: '/dashboard/themes',
      prompts: '/monitor',
      reports: '/analyze/reports',
    };
    const route = routes[section];
    if (route) navigate(route);
  }, [navigate]);


  const [error, setError] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [hasDismissedPromptsModal, setHasDismissedPromptsModal] = useState(false);

  // Track when initial load is complete - use ref to prevent unnecessary state updates
  // CRITICAL: Only set hasInitiallyLoaded once per session, never reset it
  const initialLoadCompletedRef = useRef(hasInitiallyLoaded);
  useEffect(() => {
    // Update ref from persisted state
    if (hasInitiallyLoaded) {
      initialLoadCompletedRef.current = true;
      return;
    }
    
    // Only mark as loaded once, and don't reset when returning to tab
    if (!initialLoadCompletedRef.current && !companyLoading && !loading && (currentCompany !== undefined)) {
      // Small delay to ensure everything is settled
      const timer = setTimeout(() => {
        if (!initialLoadCompletedRef.current) {
          initialLoadCompletedRef.current = true;
          setHasInitiallyLoaded(true);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [companyLoading, loading, currentCompany, setHasInitiallyLoaded, hasInitiallyLoaded]);

  // Session-scoped (in-memory) flag for "the dashboard has fully loaded at
  // least once since this Dashboard component mounted". This is intentionally
  // NOT the persisted `hasInitiallyLoaded` — that one lives in sessionStorage,
  // so logging out/in within the same tab leaves it stuck `true` and the
  // branded loader would resolve before data is ready, flashing skeletons.
  // A useRef resets on every fresh Dashboard mount (every real login/reload),
  // so the first data load is always covered by the branded loader.
  // Latched only when the branded loader has genuinely FINISHED (faded out),
  // not on the raw `isFullyLoaded` flag — that flag has a false-positive
  // window during refetch flicker, and latching on it lets the lenient
  // branch take over too early and flash a skeleton.
  const sessionFirstLoadDoneRef = useRef(false);

  // Show loading screen during initial load
  // Only show loading if we haven't loaded before OR if company is actually loading
  // CRITICAL: Never show loading when returning to tab - use persisted state and refs
  const isInitialLoading = useMemo(() => {
    // Genuine first data load of this page session: hold the branded loader
    // until the dashboard data is actually ready, so we never hand off to a
    // skeleton flash. isFullyLoaded === !loading && !metricsLoading &&
    // !competitorLoading, which always settles (even for empty/setup
    // accounts), so this can't hang.
    if (!sessionFirstLoadDoneRef.current) {
      // Hold until the HEADLINE families (prompts + rollups) are ready —
      // the Overview is fully rollup-backed, so the reveal is complete for
      // the tab the user lands on while the response stream keeps hydrating
      // behind it (per-tab loading states cover late arrivals). With the
      // persisted cache this releases instantly on a warm reopen instead of
      // re-holding for the full ~45s stream on large scopes. hydration
      // treats fetch errors and no-company accounts as ready, so this
      // can't hang.
      return companyLoading || !isFullyLoaded || !hydration.headlineReady;
    }
    // After the first full load this session, fall back to the original
    // persisted-state behavior so in-app tab returns / company switches don't
    // re-show the full loader.
    if (hasInitiallyLoaded) {
      return companyLoading && currentCompany === null;
    }
    return companyLoading || !isFullyLoaded || !hydration.headlineReady;
  }, [companyLoading, isFullyLoaded, hasInitiallyLoaded, currentCompany, hydration.headlineReady]);

  // Warm remount (user navigated away within the SPA and came back with the
  // query cache intact): everything is ready on the very first render, the
  // loader never shows, and the show→hide transition the latch below waits
  // for never happens — latch immediately so the next company switch takes
  // the lenient branch instead of re-showing the full-screen loader. Only
  // the FIRST render decides this; a mid-load ready flicker can't trigger it.
  const firstRenderLatchedRef = useRef(false);
  if (!firstRenderLatchedRef.current) {
    firstRenderLatchedRef.current = true;
    if (!isInitialLoading) {
      sessionFirstLoadDoneRef.current = true;
    }
  }

  // Keep the loading screen mounted long enough to play its completion
  // (bar snaps to 100% + fade) before the dashboard is revealed.
  const loadingHandoff = useLoadingHandoff(isInitialLoading);

  // Latch "first load done this session" only when the loader actually
  // finishes (show goes true -> false after a stable, debounced ready).
  const prevHandoffShow = useRef(loadingHandoff.show);
  useEffect(() => {
    if (prevHandoffShow.current && !loadingHandoff.show) {
      sessionFirstLoadDoneRef.current = true;
    }
    prevHandoffShow.current = loadingHandoff.show;
  }, [loadingHandoff.show]);

  // Check if user is new (less than 24 hours old)
  useEffect(() => {
    if (user?.created_at) {
      const userCreatedAt = new Date(user.created_at);
      const now = new Date();
      const hoursSinceCreation = (now.getTime() - userCreatedAt.getTime()) / (1000 * 60 * 60);
      setIsNewUser(hoursSinceCreation < 24);
    }
  }, [user?.created_at]);

  // Auto-resume incomplete data collection
  const resumeCollectionRef = useRef(resumeCollection);
  useEffect(() => {
    resumeCollectionRef.current = resumeCollection;
  }, [resumeCollection]);

  useEffect(() => {
    if (collectionStatus && !isCollectingData && currentCompany?.id === collectionStatus.companyId) {
      // Small delay to ensure page is fully loaded
      const timer = setTimeout(() => {
        resumeCollectionRef.current();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [collectionStatus?.companyId, isCollectingData, currentCompany?.id]);

  // Handle URL changes
  useEffect(() => {
    const path = location.pathname;
    
    if (path.startsWith('/dashboard')) {
      setActiveGroup('dashboard');
      if (path === '/dashboard') {
        setActiveSection('overview');
      } else if (path === '/dashboard/sources') {
        setActiveSection('sources');
      } else if (path === '/dashboard/competitors') {
        setActiveSection('competitors');
      } else if (path === '/dashboard/themes') {
        setActiveSection('thematic');
      }
    } else if (path.startsWith('/monitor')) {
      setActiveGroup('monitor');
      if (path === '/monitor') {
        setActiveSection('prompts');
      }
    } else if (path.startsWith('/analyze')) {
      setActiveGroup('analyze');
      if (path === '/analyze') {
        setActiveSection('thematic');
      } else if (path === '/analyze/thematic') {
        setActiveSection('thematic');
      } else if (path === '/analyze/reports') {
        setActiveSection('reports');
      }
    }
  }, [location.pathname]);

  // Track lazy tab visits so they stay mounted after first visit
  useEffect(() => {
    setHasVisited(prev => {
      const key = activeSection;
      if (key in prev && !prev[key as keyof typeof prev]) {
        return { ...prev, [key]: true };
      }
      return prev;
    });
  }, [activeSection]);

  // Stable identity: passed to memoized tabs (CompetitorsTab), where an inline
  // arrow would defeat their React.memo on every Dashboard render.
  const handleNavigateToSources = useCallback(() => {
    handleSectionChange('sources');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  const handleSectionChange = (section: string) => {
    // Wrap in startTransition so the UI stays responsive during tab switch
    startTransition(() => {
      setActiveSection(section);
    });

    // Update URL based on section
    if (activeGroup === 'dashboard') {
      if (section === 'overview') {
        navigate('/dashboard');
      } else if (section === 'sources') {
        navigate('/dashboard/sources');
      } else if (section === 'competitors') {
        navigate('/dashboard/competitors');
      } else if (section === 'thematic') {
        navigate('/dashboard/themes');
      }
    } else if (activeGroup === 'monitor') {
      if (section === 'prompts') {
        navigate('/monitor');
      }
    } else if (activeGroup === 'analyze') {
      if (section === 'thematic') {
        navigate('/analyze/thematic');
      } else if (section === 'reports') {
        navigate('/analyze/reports');
      }
    }
  };

  const renderDashboardContent = () => {
    // Full section skeleton ONLY when there is genuinely nothing to paint —
    // the first uncached load of a scope (no responses, metrics still at
    // their 'No Data' placeholder; the computed path never yields that
    // label). Cached scopes and background revalidation keep real data in
    // `responses`/`metrics`, and swapping the tree for a skeleton would
    // unmount every visited tab — the header refresh chip covers the
    // stale-while-revalidating window instead.
    const hasRenderableData = responses.length > 0 || metrics.perceptionLabel !== 'No Data';
    if ((!isFullyLoaded || locationMetricsLoading) && !hasRenderableData) {
      switch (activeSection) {
        case "overview": return <OverviewSkeleton />;
        case "prompts": return <PromptsSkeleton />;
        case "reports": return <ReportsSkeleton />;
        case "sources": return <SourcesSkeleton />;
        case "competitors": return <CompetitorsSkeleton />;
        case "thematic": return <ThematicSkeleton />;
        case "search": return <SearchSkeleton />;
        default: return <OverviewSkeleton />;
      }
    }

    const reportsContent = activeSection === 'reports' ? (
      <CustomReports />
    ) : null;

    return (
      <div className="w-full">
        {/* OverviewTab — always mounted (default landing tab) */}
        <div style={{ display: activeSection === 'overview' ? 'block' : 'none' }}>
          <OverviewTab
            responses={responses}
            metrics={metrics}
            metricsByJobFunction={metricsByJobFunction}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            competitorLoading={competitorLoading}
            companyName={companyName}
            llmMentionRankings={llmMentionRankings}
            searchResults={searchResults}
            aiThemes={aiThemes}
            attributeThemes={attributeThemes}
            responseSentimentRows={responseSentimentRows}
            recencyData={recencyData}
            recencyDataLoading={recencyDataLoading}
            aiThemesLoading={aiThemesLoading}
            responsesLoading={responsesStreaming}
            metricsCalculating={metricsCalculating}
            responseTexts={responseTexts}
            fetchResponseTexts={fetchResponseTexts}
            previousPeriodMetrics={previousPeriodMetrics}
            companyRelevanceByMonth={companyRelevanceByMonth}
            previousPeriodResponses={previousPeriodResponses}
            epsTrend={epsTrend}
            epsChange={epsChange}
            epsTrendByJobFunction={epsTrendByJobFunction}
            epsChangeByJobFunction={epsChangeByJobFunction}
            market={selectedMarketName}
            selectedJobFunction={selectedJobFunction}
            onJobFunctionChange={handleJobFunctionChange}
            domainStats={domainStats}
            competitorStats={competitorStats}
            cubeScopeRows={cubeScopeRows}
            cubePromptTypeRows={cubePromptTypeRows}
            cubeDailyRows={cubeDailyRows}
            cubeDailyUnsound={cubeDailyUnsound}
            cubeQuarterKey={cubeQuarterKey}
            cubePrevQuarterKey={cubePrevQuarterKey}
            cubeMonthFloor={cubeMonthFloor}
            cubesLoading={cubesLoading}
          />
        </div>

        {/* Lazy tabs — mount on first visit, then stay alive */}
        {(activeSection === 'sources' || hasVisited.sources) && (
          <div style={{ display: activeSection === 'sources' ? 'block' : 'none' }}>
            <Suspense fallback={<SourcesSkeleton />}>
              <SourcesTab
                topCitations={topCitations}
                responses={responses}
                parseCitations={parseCitations}
                companyName={companyName}
                searchResults={searchResults}
                currentCompanyId={currentCompany?.id}
                responseTexts={responseTexts}
                fetchResponseTexts={fetchResponseTexts}
                previousPeriodResponses={previousPeriodResponses}
                responsesLoading={responsesStreaming}
                selectedJobFunction={selectedJobFunction}
                onJobFunctionChange={handleJobFunctionChange}
                responseSentimentRows={responseSentimentRows}
                domainStats={domainStats}
                cubeScopeRows={cubeScopeRows}
                cubeQuarterKey={cubeQuarterKey}
                cubePrevQuarterKey={cubePrevQuarterKey}
                cubesLoading={cubesLoading}
              />
            </Suspense>
          </div>
        )}

        {(activeSection === 'competitors' || hasVisited.competitors) && (
          <div style={{ display: activeSection === 'competitors' ? 'block' : 'none' }}>
            <Suspense fallback={<CompetitorsSkeleton />}>
              <CompetitorsTab
                responses={responses}
                companyName={companyName}
                currentCompanyId={currentCompany?.id}
                responseTexts={responseTexts}
                fetchResponseTexts={fetchResponseTexts}
                previousPeriodResponses={previousPeriodResponses}
                responsesLoading={responsesStreaming}
                selectedJobFunction={selectedJobFunction}
                onJobFunctionChange={handleJobFunctionChange}
                responseSentimentRows={responseSentimentRows}
                recencyData={recencyData}
                onNavigateToSources={handleNavigateToSources}
                competitorStats={competitorStats}
                cubePromptTypeRows={cubePromptTypeRows}
                cubeQuarterKey={cubeQuarterKey}
                cubePrevQuarterKey={cubePrevQuarterKey}
                cubesLoading={cubesLoading}
              />
            </Suspense>
          </div>
        )}

        {(activeSection === 'thematic' || hasVisited.thematic) && (
          <div style={{ display: activeSection === 'thematic' ? 'block' : 'none' }}>
            <Suspense fallback={<ThematicSkeleton />}>
              <ThematicAnalysisTab
                responses={responses}
                companyName={companyName}
                aiThemes={aiThemes}
                aiThemesLoading={aiThemesLoading}
                attributeThemes={attributeThemes}
                fetchAIThemesForAttribute={fetchAIThemesForAttribute}
                aiThemeAttrsLoaded={aiThemeAttrsLoaded}
                onRefreshThemes={refreshData}
                responseTexts={responseTexts}
                fetchResponseTexts={fetchResponseTexts}
                previousPeriodResponses={previousPeriodResponses}
                responsesLoading={responsesStreaming}
                selectedJobFunction={selectedJobFunction}
                onJobFunctionChange={handleJobFunctionChange}
                cubeQuarterKey={cubeQuarterKey}
                cubeMonthFloor={cubeMonthFloor}
                cubeScopeRows={cubeScopeRows}
                cubePromptTypeRows={cubePromptTypeRows}
              />
            </Suspense>
          </div>
        )}
        {(activeSection === 'prompts' || hasVisited.prompts) && (
          <div style={{ display: activeSection === 'prompts' ? 'block' : 'none' }}>
            <Suspense fallback={<PromptsSkeleton />}>
              <PromptsTab
                promptsData={promptsData}
                responses={responses}
                companyName={companyName}
                onRefresh={refreshData}
                onRefreshPrompts={handleRefreshPrompts}
                isRefreshing={isRefreshing}
                refreshProgress={refreshProgress}
                responseTexts={responseTexts}
                fetchResponseTexts={fetchResponseTexts}
                scopeCompanyIds={scopeCompanyIds}
                responsesLoading={responsesStreaming}
                selectedJobFunction={selectedJobFunction}
                onJobFunctionChange={handleJobFunctionChange}
              />
            </Suspense>
          </div>
        )}

        {activeSection === 'reports' && reportsContent && (
          <div>{reportsContent}</div>
        )}
      </div>
    );
  };

  // Show full loading screen during initial load (and through its completion).
  if (loadingHandoff.show) {
    // Narrate the real load: each line maps to an actual fetch family in
    // useDashboardData, so the checklist reflects genuine progress rather
    // than a timer.
    return (
      <LoadingScreen
        completing={loadingHandoff.completing}
        stages={[
          { label: 'Loading your prompt library', done: hydration.prompts },
          { label: 'Collecting the latest AI responses', done: hydration.responsesFirst },
          { label: 'Analysing sources, competitors & sentiment', done: hydration.rollups },
          { label: 'Finalising the full response set', done: hydration.responsesFull },
        ]}
      />
    );
  }

  // Always render the sidebar and main layout, only show loading in content area
  return (
    <div className="flex h-screen bg-gray-50 w-full">
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onNavigate={navigateToSection}
        promptsData={promptsData}
        topCompetitors={topCompetitors}
        topCitations={topCitations}
      />
      <AppSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onOpenSearch={() => setCommandOpen(true)}
      />
      <SidebarInset className="relative flex-1 flex flex-col">
        {/* Background revalidation indicator — content stays mounted and
            interactive while a cached scope refetches, so this must never
            block clicks or shift layout: a pinned, pointer-transparent chip
            in the header's own surface treatment. */}
        {isDataRefreshing && (
          <div className="pointer-events-none absolute right-6 top-20 z-20 flex items-center gap-1.5 rounded-full border border-gray-200/50 bg-white/80 px-2.5 py-1 text-xs text-gray-500 shadow-sm backdrop-blur-sm">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Refreshing</span>
          </div>
        )}
        <DashboardHeader
          companyName={companyName || ''}
          responsesCount={responses.length}
          breadcrumbs={[
            { label: activeGroup.charAt(0).toUpperCase() + activeGroup.slice(1), active: false },
            { label: activeSection.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()), active: true }
          ]}
          onFixData={fixExistingPrompts}
          hasDataIssues={hasDataIssues}
          alwaysMounted={true}
          selectedLocation={activeSection === 'reports' ? undefined : selectedLocation}
          onLocationChange={activeSection === 'reports' ? undefined : handleLocationChange}
          onPendingLocationChange={activeSection === 'reports' ? undefined : setPendingLocation}
          locationOptions={activeSection === 'reports' ? undefined : locationOptions}
          availablePeriods={activeSection === 'reports' ? undefined : availablePeriods}
          selectedPeriod={activeSection === 'reports' ? undefined : selectedPeriod}
          onPeriodChange={activeSection === 'reports' ? undefined : handlePeriodChange}
          userId={user?.id ?? null}
          companyId={currentCompany?.id ?? null}
          onLocationPrefetch={activeSection === 'reports' ? undefined : prefetchLocationRollups}
          onCompanyPrefetch={prefetchCompanyRollups}
        />
        <div className="flex-1 overflow-auto">
          {error ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
                <p className="text-gray-600 mb-4">{error}</p>
                <Button onClick={() => window.location.reload()}>
                  Try Again
                </Button>
              </div>
            </div>
          ) : connectionError ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center max-w-md">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Issue</h2>
                <p className="text-gray-600 mb-4">{connectionError}</p>
                <div className="flex gap-3 justify-center">
                  <Button onClick={refreshData} variant="outline">
                    Retry
                  </Button>
                  <Button onClick={() => window.location.reload()}>
                    Refresh Page
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {renderDashboardContent()}
            </div>
          )}
        </div>
      </SidebarInset>
    </div>
  );
};

interface DashboardProps {
  defaultGroup?: string;
  defaultSection?: string;
}

const Dashboard = ({ defaultGroup, defaultSection }: DashboardProps = {}) => (
  <SidebarProvider>
    <WalkthroughProvider>
      <TabSearchSeedProvider>
        <DashboardContent defaultGroup={defaultGroup} defaultSection={defaultSection} />
      </TabSearchSeedProvider>
    </WalkthroughProvider>
  </SidebarProvider>
);

export default Dashboard;