import { useState, useEffect, useMemo } from 'react';
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
import { CareerSiteAnalysisTab } from "@/components/dashboard/CareerSiteAnalysisTab";
import { SearchTab } from "@/components/dashboard/SearchTab";
import { ThematicAnalysisTab } from "@/components/dashboard/ThematicAnalysisTab";
import { ReportGenerator } from "@/components/dashboard/ReportGenerator";
import { AppSidebar } from "@/components/AppSidebar";
import { UpgradeModal } from "@/components/upgrade/UpgradeModal";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronRight, LayoutDashboard, Lock, Globe, Users, TrendingUp, BarChart3, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showWelcomeProModal, setShowWelcomeProModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'terms' | 'results'>('results');
  const [chartView, setChartView] = useState<'bubble' | 'bar'>('bubble');

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
  
  const {
    responses,
    loading,
    competitorLoading,
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
    fetchSearchResults
  } = useDashboardData();
  const { isPro } = useSubscription();

  // Load search results once when component mounts and company name is available
  useEffect(() => {
    if (companyName && searchResults.length === 0 && !searchResultsLoading) {
      fetchSearchResults();
    }
  }, [companyName, searchResults.length, searchResultsLoading, fetchSearchResults]);


  const [answerGapsData, setAnswerGapsData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState(defaultSection || "overview");
  const [activeGroup, setActiveGroup] = useState(defaultGroup || "dashboard");
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();


  const [onboardingData, setOnboardingData] = useState<PromptsModalOnboardingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [hasDismissedPromptsModal, setHasDismissedPromptsModal] = useState(false);

  // Check if user is new (less than 24 hours old)
  useEffect(() => {
    if (user?.created_at) {
      const userCreatedAt = new Date(user.created_at);
      const now = new Date();
      const hoursSinceCreation = (now.getTime() - userCreatedAt.getTime()) / (1000 * 60 * 60);
      setIsNewUser(hoursSinceCreation < 24);
    }
  }, [user?.created_at]);

  // Fetch onboarding data
  useEffect(() => {
    const fetchOnboardingData = async () => {
      if (!user) return;

      try {
        setIsLoading(true);
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
      } catch (error) {
        console.error('Error fetching onboarding data:', error);
        setError('Failed to load onboarding data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchOnboardingData();
  }, [user]);

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
      } else if (path === '/analyze/career-site') {
        setActiveSection('career-site');
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
      } else if (section === 'career-site') {
        navigate('/analyze/career-site');
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
          />
        </div>
      </div>
    );
  };

  const renderActiveSection = () => {
    if (loading) {
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

    // Show setup prompt if no responses and not loading
    if (!loading && responses.length === 0 && !hasDataIssues) {
      return renderSetupBlurredOverview();
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
          />
        );
      case "prompts":
        return <PromptsTab promptsData={promptsData} responses={responses} />;
      case "responses":
        return <ResponsesTab responses={responses} parseCitations={parseCitations} />;
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
        return <SourcesTab topCitations={topCitations} responses={responses} parseCitations={parseCitations} companyName={companyName} searchResults={searchResults} />;
      case "competitors":
        const competitorsContent = (
          <CompetitorsTab 
            topCompetitors={topCompetitors}
            responses={responses}
            companyName={companyName}
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
      case "career-site":
        return <CareerSiteAnalysisTab />;
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
          />
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 w-full">
      <AppSidebar 
        activeSection={activeSection} 
        onSectionChange={handleSectionChange}
      />
      <SidebarInset className="flex-1 flex flex-col overflow-hidden w-full">
        <DashboardHeader 
          companyName={companyName}
          responsesCount={responses.length}
          lastUpdated={lastUpdated}
          onRefresh={refreshData}
          hasDataIssues={hasDataIssues}
          onFixData={fixExistingPrompts}
          breadcrumbs={[
            { label: activeGroup.charAt(0).toUpperCase() + activeGroup.slice(1), active: false },
            { label: activeSection.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()), active: true }
          ]}
        />
        
        <div className="flex-1 overflow-auto w-full">
          <div className="p-6 w-full">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 whitespace-nowrap">
                    {activeSection === "responses" ? "Responses" :
                     activeSection === "prompts" ? "Prompts" :
                     activeSection === "search" ? "Search Insights" :
                     activeSection === "sources" ? "Sources" :
                     activeSection === "competitors" ? "Competitors" :
                     activeSection === "thematic" ? "Thematic Analysis" :
                     activeSection === "answer-gaps" ? "Answer Gaps Analysis" :
                     activeSection === "career-site" ? "Career Site Analysis" :
                     activeSection === "reports" ? "Reports" : "Dashboard"}
                  </h1>
                  <div className="flex items-center justify-between">
                    <p className="text-gray-600">
                      {activeSection === "responses"
                        ? "Manage and monitor all the individual responses for your prompts."
                        : activeSection === "prompts"
                        ? "Manage and monitor your AI prompts across different categories."
                        : activeSection === "search"
                        ? "Analyze search insights and competitor positioning for your company's career presence."
                        : activeSection === "sources"
                        ? "Analyze the sources influencing how AI sees your employer brand."
                        : activeSection === "competitors"
                        ? "Analyze the companies competing with you for talent."
                        : activeSection === "thematic"
                        ? "Extract and analyze key themes from your response data mapped to talent attributes."
                        : activeSection === "answer-gaps"
                        ? "Analyze and identify gaps in AI responses about your company."
                        : activeSection === "career-site"
                        ? "Analyze your career website content and identify gaps between what's published and what AI responses say."
                        : activeSection === "reports"
                        ? "Generate comprehensive reports about your AI perception and performance."
                        : "Monitor and analyze your AI perception across different platforms and models."}
                    </p>
                    {activeSection === "search" && (searchResults.length > 0 || searchTermsData.length > 0) && (
                      <div className="bg-gray-100 rounded-lg p-1 ml-4">
                        <button
                          onClick={() => setActiveTab('results')}
                          className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'results'
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          Results
                        </button>
                        <button
                          onClick={() => setActiveTab('terms')}
                          className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'terms'
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          Terms
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {activeSection === "thematic" && (
                  <div className="hidden md:flex bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setChartView('bubble')}
                      className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                        chartView === 'bubble'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <Activity className="w-4 h-4 inline mr-1" />
                      SWOT
                    </button>
                    <button
                      onClick={() => setChartView('bar')}
                      className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                        chartView === 'bar'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <BarChart3 className="w-4 h-4 inline mr-1" />
                      Bar
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            {renderActiveSection()}
          </div>
        </div>
      </SidebarInset>
      
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