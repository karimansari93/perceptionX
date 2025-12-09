import { useState, useEffect, useMemo, useRef } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { PromptsTab } from "@/components/dashboard/PromptsTab";
import { ResponsesTab } from "@/components/dashboard/ResponsesTab";
import { SourcesTab } from "@/components/dashboard/SourcesTab";
import { CompetitorsTab } from "@/components/dashboard/CompetitorsTab";
import { AnswerGapsTab } from "@/components/dashboard/AnswerGapsTab";
import { SearchTab } from "@/components/dashboard/SearchTab";
import { ThematicAnalysisTab } from "@/components/dashboard/ThematicAnalysisTab";
import { ReportGenerator } from "@/components/dashboard/ReportGenerator";
import { AppSidebar } from "@/components/AppSidebar";
import { UpgradeModal } from "@/components/upgrade/UpgradeModal";
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
  ResponsesSkeleton, 
  AnswerGapsSkeleton, 
  ReportsSkeleton 
} from "@/components/dashboard/SectionSkeletons";
import { KeyTakeaways } from "@/components/dashboard/KeyTakeaways";
import LLMLogo from "@/components/LLMLogo";
import { useSubscription } from "@/hooks/useSubscription";
import { WelcomeProModal } from "@/components/upgrade/WelcomeProModal";
import { AddCompanyModal } from "@/components/dashboard/AddCompanyModal";
import { useRefreshPrompts } from "@/hooks/useRefreshPrompts";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { useCompanyDataCollection } from "@/hooks/useCompanyDataCollection";
import { usePersistedState } from "@/hooks/usePersistedState";

interface DatabaseOnboardingData {
  company_name: string;
  industry: string;
  user_id?: string;
  session_id?: string;
  created_at?: string;
  id?: string;
}

interface PromptsModalOnboardingData {
  companyName: string;
  industry: string;
  id?: string;
}

const DashboardContent = ({ defaultGroup, defaultSection }: DashboardProps = {}) => {
  const { user } = useAuth();
  const { currentCompany, loading: companyLoading } = useCompany();
  // Persist initial load state so we don't show loading screen on every navigation
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = usePersistedState<boolean>('dashboard.hasInitiallyLoaded', false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showWelcomeProModal, setShowWelcomeProModal] = useState(false);
  // Use sessionStorage to persist modal state across tab switches
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(() => {
    try {
      const saved = sessionStorage.getItem('showAddCompanyModal');
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [activeTab, setActiveTab] = useState<'terms' | 'results'>('results');
  const [chartView, setChartView] = useState<'bubble' | 'bar'>('bubble');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
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

  // Sync modal state with sessionStorage
  useEffect(() => {
    try {
      if (showAddCompanyModal) {
        sessionStorage.setItem('showAddCompanyModal', 'true');
      } else {
        sessionStorage.removeItem('showAddCompanyModal');
      }
    } catch (error) {
      console.warn('Failed to sync modal state with sessionStorage:', error);
    }
  }, [showAddCompanyModal]);

  // Cleanup sessionStorage on unmount
  useEffect(() => {
    return () => {
      try {
        sessionStorage.removeItem('showAddCompanyModal');
      } catch (error) {
        console.warn('Failed to cleanup modal state from sessionStorage:', error);
      }
    };
  }, []);
  
  const {
    responses,
    loading,
    competitorLoading,
    metricsLoading,
    isFullyLoaded,
    companyName,
    metrics,
    sentimentTrend,
    topCitations,
    promptsData,
    refreshData,
    parseCitations,
    topCompetitors,
    lastUpdated,
    llmMentionRankings,
    talentXProData,
    talentXProLoading,
    fixExistingPrompts,
    hasDataIssues,
    searchResults,
    searchResultsLoading,
    searchTermsData,
    fetchSearchResults,
    aiThemes,
    isOnline,
    connectionError,
    recencyDataError,
    recencyData,
    recencyDataLoading,
    aiThemesLoading
  } = useDashboardData();
  const { isPro } = useSubscription();

  // Load search results once when component mounts and company name is available
  useEffect(() => {
    if (companyName && searchResults.length === 0 && !searchResultsLoading) {
      fetchSearchResults();
    }
  }, [companyName, searchResults.length, searchResultsLoading]); // Removed fetchSearchResults from deps


  const [answerGapsData, setAnswerGapsData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState(defaultSection || "overview");
  const [activeGroup, setActiveGroup] = useState(defaultGroup || "dashboard");
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();


  const [onboardingData, setOnboardingData] = useState<PromptsModalOnboardingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
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
    if (!initialLoadCompletedRef.current && !companyLoading && !loading && !isLoading && (currentCompany !== undefined)) {
      // Small delay to ensure everything is settled
      const timer = setTimeout(() => {
        if (!initialLoadCompletedRef.current) {
          initialLoadCompletedRef.current = true;
          setHasInitiallyLoaded(true);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [companyLoading, loading, isLoading, currentCompany, setHasInitiallyLoaded, hasInitiallyLoaded]);

  // Show loading screen during initial load
  // Only show loading if we haven't loaded before OR if company is actually loading
  // CRITICAL: Never show loading when returning to tab - use persisted state and refs
  const isInitialLoading = useMemo(() => {
    // If we've loaded before (persisted state), never show loading again unless explicitly switching companies
    if (hasInitiallyLoaded) {
      // Only show loading if company is actively loading AND we don't have a current company yet
      // This prevents showing loading when returning to tab
      return companyLoading && currentCompany === null;
    }
    // First time load - show loading while data is being fetched
    return companyLoading || loading || isLoading;
  }, [companyLoading, loading, isLoading, hasInitiallyLoaded, currentCompany]);

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
      console.log('[Dashboard] Auto-resuming collection for company:', collectionStatus.companyId);
      // Small delay to ensure page is fully loaded
      const timer = setTimeout(() => {
        console.log('[Dashboard] Calling resumeCollection');
        resumeCollectionRef.current();
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      console.log('[Dashboard] Not auto-resuming:', {
        hasStatus: !!collectionStatus,
        isCollecting: isCollectingData,
        companyMatch: currentCompany?.id === collectionStatus?.companyId
      });
    }
  }, [collectionStatus?.companyId, isCollectingData, currentCompany?.id]);

  // Fetch onboarding data - only once per user ID, not on every user object reference change
  const onboardingDataFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fetchOnboardingData = async () => {
      if (!user?.id) return;
      
      // Only fetch if we haven't already fetched for this user ID
      if (onboardingDataFetchedRef.current.has(user.id)) {
        return;
      }

      try {
        // Only show loading if we don't have onboarding data yet
        if (!onboardingData) {
          setIsLoading(true);
        }
        const { data, error } = await supabase
          .from('user_onboarding')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
          const onboarding = data[0];
          setOnboardingData({
            companyName: onboarding.company_name,
            industry: onboarding.industry,
            id: onboarding.id
          });
          setOnboardingId(onboarding.id);
        }
        // Mark this user ID as fetched
        onboardingDataFetchedRef.current.add(user.id);
      } catch (error) {
        console.error('Error fetching onboarding data:', error);
        setError('Failed to load onboarding data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchOnboardingData();
  }, [user?.id, onboardingData]); // Only depend on user.id, not the whole user object

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
      } else if (path === '/monitor/responses') {
        setActiveSection('responses');
      } else if (path === '/monitor/search') {
        setActiveSection('search');
      }
    } else if (path.startsWith('/analyze')) {
      setActiveGroup('analyze');
      if (path === '/analyze') {
        setActiveSection('thematic');
      } else if (path === '/analyze/thematic') {
        setActiveSection('thematic');
      } else if (path === '/analyze/answer-gaps') {
        setActiveSection('answer-gaps');
      } else if (path === '/analyze/reports') {
        setActiveSection('reports');
      }
    }
  }, [location.pathname]);

  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    
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
      } else if (section === 'responses') {
        navigate('/monitor/responses');
      } else if (section === 'search') {
        navigate('/monitor/search');
      }
    } else if (activeGroup === 'analyze') {
      if (section === 'thematic') {
        navigate('/analyze/thematic');
      } else if (section === 'answer-gaps') {
        navigate('/analyze/answer-gaps');
      } else if (section === 'reports') {
        navigate('/analyze/reports');
      }
    }
  };

  const renderSetupBlurredOverview = () => {
    return (
      <div className="relative min-h-[600px]">
        {/* Overlay for users who haven't set up prompts */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
          <div className="text-center p-8 max-w-lg mx-auto">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Welcome to PerceptionX</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              To get started, you'll need to set up your first prompts to begin monitoring your AI perception.
            </p>
            <Button 
              onClick={() => navigate('/onboarding')}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              Get Started
            </Button>
          </div>
        </div>
        {/* Blurred/disabled content underneath */}
        <div className="blur-sm pointer-events-none select-none opacity-60">
          <OverviewTab 
            responses={responses}
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            competitorLoading={competitorLoading}
            companyName={companyName}
            llmMentionRankings={llmMentionRankings}
            talentXProData={talentXProData}
            isPro={isPro}
            searchResults={searchResults}
            aiThemes={aiThemes}
            recencyData={recencyData}
            recencyDataLoading={recencyDataLoading}
            aiThemesLoading={aiThemesLoading}
          />
        </div>
      </div>
    );
  };

  const renderActiveSection = () => {
    if (!isFullyLoaded) {
      switch (activeSection) {
        case "overview":
          return <OverviewSkeleton />;
        case "prompts":
          return <PromptsSkeleton />;
        case "responses":
          return <ResponsesSkeleton />;
        case "answer-gaps":
          return <AnswerGapsSkeleton />;
        case "reports":
          return <ReportsSkeleton />;
        default:
          return <OverviewSkeleton />;
      }
    }

    // Only show welcome screen if we have NO company at all
    if (!isFullyLoaded && !companyName) {
      return renderSetupBlurredOverview();
    }

    // If we have a company but no responses yet, show analyzing state
    if (!isFullyLoaded && responses.length === 0 && promptsData && promptsData.length > 0) {
      return (
        <div className="min-h-[600px] flex items-center justify-center">
          <div className="text-center p-8 max-w-lg mx-auto">
            <img
              alt="Perception Logo"
              className="object-contain h-16 w-16 mx-auto mb-4 animate-pulse"
              src="/logos/PinkBadge.png"
            />
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Analysis in Progress</h2>
            <p className="text-gray-600 mb-2 leading-relaxed">
              We're currently analyzing {companyName} across multiple AI platforms.
            </p>
            <p className="text-sm text-gray-500">
              This process takes 2-3 minutes. You can check back shortly or refresh the page.
            </p>
          </div>
        </div>
      );
    }

    switch (activeSection) {
      case "overview":
        return (
          <OverviewTab 
            responses={responses}
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            competitorLoading={competitorLoading}
            companyName={companyName}
            llmMentionRankings={llmMentionRankings}
            talentXProData={talentXProData}
            isPro={isPro}
            searchResults={searchResults}
            aiThemes={aiThemes}
            recencyData={recencyData}
            recencyDataLoading={recencyDataLoading}
            aiThemesLoading={aiThemesLoading}
          />
        );
      case "prompts":
        return (
          <PromptsTab
            promptsData={promptsData}
            responses={responses}
            companyName={companyName}
            onRefresh={refreshData}
            onRefreshPrompts={async (ids, name) => {
              const targetName = name || companyName || currentCompany?.name;
              if (!targetName || ids.length === 0) return;
              await refreshAllPrompts(targetName, { promptIds: ids });
            }}
            isRefreshing={isRefreshing}
            refreshProgress={refreshProgress}
          />
        );
      case "responses":
        return <ResponsesTab responses={responses} parseCitations={parseCitations} companyName={companyName} />;
      case "search":
        return (
          <SearchTab 
            companyName={companyName}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            searchResults={searchResults}
            searchTermsData={searchTermsData}
          />
        );
      case "sources":
        return <SourcesTab key={companyName} topCitations={topCitations} responses={responses} parseCitations={parseCitations} companyName={companyName} searchResults={searchResults} currentCompanyId={currentCompany?.id} />;
      case "competitors":
        const competitorsContent = (
          <CompetitorsTab 
            topCompetitors={topCompetitors}
            responses={responses}
            companyName={companyName}
            searchResults={searchResults.filter(r => r.company_id === currentCompany?.id)}
          />
        );
        return competitorsContent;
      case "thematic":
        return (
          <ThematicAnalysisTab 
            responses={responses}
            companyName={companyName}
            chartView={chartView}
            setChartView={setChartView}
          />
        );
      case "answer-gaps":
        return <AnswerGapsTab />;
      case "reports":
        const reportsContent = (
          <ReportGenerator
            companyName={companyName}
            responses={responses}
            metrics={metrics}
            sentimentTrend={sentimentTrend}
            topCitations={topCitations}
            promptsData={promptsData}
          />
        );
        
        // Show reports content for Pro users, or upgrade prompt for free users
        if (isPro) {
          return reportsContent;
        } else {
          return (
            <div className="relative min-h-[600px]">
              {/* Overlay for Free Users */}
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
                <div className="text-center p-8 max-w-lg mx-auto">
                  <h2 className="text-2xl font-bold mb-4 text-gray-800">Reports - Pro Feature</h2>
                  <p className="text-gray-600 mb-6 leading-relaxed">
                    Generate comprehensive reports about your AI perception and performance. 
                    Get detailed insights, competitor analysis, and actionable recommendations.
                  </p>
                  <Button 
                    onClick={() => setShowUpgradeModal(true)}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
                  >
                    Upgrade to Pro
                  </Button>
                </div>
              </div>
              {/* Blurred/disabled content underneath */}
              <div className="blur-sm pointer-events-none select-none opacity-60">
                {reportsContent}
              </div>
            </div>
          );
        }
      default:
        return (
          <OverviewTab 
            responses={responses}
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            competitorLoading={competitorLoading}
            companyName={companyName}
            llmMentionRankings={llmMentionRankings}
            talentXProData={talentXProData}
            isPro={isPro}
            searchResults={searchResults}
            aiThemes={aiThemes}
            recencyData={recencyData}
            recencyDataLoading={recencyDataLoading}
            aiThemesLoading={aiThemesLoading}
          />
        );
    }
  };

  // Show full loading screen during initial load
  if (isInitialLoading) {
    return <LoadingScreen />;
  }

  // Always render the sidebar and main layout, only show loading in content area
  return (
    <div className="flex h-screen bg-gray-50 w-full">
      <AppSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
      <SidebarInset className="flex-1 flex flex-col">
        <DashboardHeader 
          companyName={companyName || ''}
          responsesCount={responses.length}
          onRefresh={refreshData}
          breadcrumbs={[
            { label: activeGroup.charAt(0).toUpperCase() + activeGroup.slice(1), active: false },
            { label: activeSection.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()), active: true }
          ]}
          lastUpdated={lastUpdated}
          onFixData={fixExistingPrompts}
          hasDataIssues={hasDataIssues}
          showAddCompanyModal={showAddCompanyModal}
          setShowAddCompanyModal={setShowAddCompanyModal}
          showUpgradeModal={showUpgradeModal}
          setShowUpgradeModal={setShowUpgradeModal}
          alwaysMounted={true}
          isRefreshing={isRefreshing || isCollectingData}
          refreshProgress={isCollectingData ? collectionProgress : refreshProgress}
          selectedLocation={selectedLocation}
          onLocationChange={setSelectedLocation}
          onAddLocation={() => setShowAddLocationModal(true)}
        />
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <img
                  alt="Perception Logo"
                  className="object-contain h-16 w-16 mx-auto mb-4 animate-pulse"
                  src="/logos/PinkBadge.png"
                />
                <p className="text-gray-600">Loading...</p>
              </div>
            </div>
          ) : error ? (
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
              {renderActiveSection()}
            </div>
          )}
        </div>
      </SidebarInset>
      
      {/* Modals */}
      <AddCompanyModal 
        open={showAddCompanyModal}
        onOpenChange={setShowAddCompanyModal}
        alwaysMounted={true}
      />
      <AddCompanyModal 
        open={showAddLocationModal}
        onOpenChange={setShowAddLocationModal}
        alwaysMounted={true}
        existingCompanyName={currentCompany?.name}
        existingIndustry={currentCompany?.industry}
        mode="add-location"
      />
      <UpgradeModal 
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
      />
      <WelcomeProModal 
        open={showWelcomeProModal}
        onOpenChange={setShowWelcomeProModal}
      />
    </div>
  );
};

interface DashboardProps {
  defaultGroup?: string;
  defaultSection?: string;
}

const Dashboard = ({ defaultGroup, defaultSection }: DashboardProps = {}) => (
  <SidebarProvider>
    <DashboardContent defaultGroup={defaultGroup} defaultSection={defaultSection} />
  </SidebarProvider>
);

export default Dashboard;