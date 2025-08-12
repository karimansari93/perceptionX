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
import { TalentXTab } from "@/components/dashboard/TalentXTab";
import { ReportGenerator } from "@/components/dashboard/ReportGenerator";
import { AppSidebar } from "@/components/AppSidebar";
import { UpgradeModal } from "@/components/upgrade/UpgradeModal";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronRight, LayoutDashboard, Lock, Target, Globe, Users } from "lucide-react";
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
import { generatePlaceholderTalentXData } from "@/config/talentXAttributes";
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

const transformOnboardingData = (data: DatabaseOnboardingData): PromptsModalOnboardingData => ({
  companyName: data.company_name,
  industry: data.industry,
  id: data.id
});

const PROMPTS_COMPLETED_KEY = 'promptsCompleted';

const hasCompletedPrompts = (onboardingId: string | null) => {
  if (!onboardingId) return false;
  const completed = localStorage.getItem(PROMPTS_COMPLETED_KEY);
  if (!completed) return false;
  try {
    const completedIds = JSON.parse(completed);
    return Array.isArray(completedIds) && completedIds.includes(onboardingId);
  } catch {
    return false;
  }
};

export const setPromptsCompleted = (onboardingId: string | null) => {
  if (!onboardingId) return;
  const completed = localStorage.getItem(PROMPTS_COMPLETED_KEY);
  let completedIds: string[] = [];
  try {
    completedIds = completed ? JSON.parse(completed) : [];
  } catch {
    completedIds = [];
  }
  if (!completedIds.includes(onboardingId)) {
    completedIds.push(onboardingId);
    localStorage.setItem(PROMPTS_COMPLETED_KEY, JSON.stringify(completedIds));
  }
};

interface DashboardProps {
  defaultGroup?: string;
  defaultSection?: string;
}

const DashboardContent = ({ defaultGroup, defaultSection }: DashboardProps = {}) => {
  const { user } = useAuth();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showWelcomeProModal, setShowWelcomeProModal] = useState(false);
  
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
    hasDataIssues
  } = useDashboardData();
  const { isPro } = useSubscription();

  const [answerGapsData, setAnswerGapsData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState(defaultSection || "overview");
  const [activeGroup, setActiveGroup] = useState(defaultGroup || "dashboard");
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();

  // Process TalentX data - use Pro data if available, otherwise fallback to placeholder
  const talentXData = useMemo(() => {
    // If user is Pro and we have Pro data, use it
    if (isPro && talentXProData && talentXProData.length > 0) {
      return talentXProData;
    }
    
    // Otherwise use placeholder data
    return generatePlaceholderTalentXData(companyName || 'Your Company');
  }, [isPro, talentXProData, companyName]);

  const [onboardingData, setOnboardingData] = useState<PromptsModalOnboardingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [hasDismissedPromptsModal, setHasDismissedPromptsModal] = useState(false);
  const justFinishedOnboarding = !!location.state?.shouldRefresh;

  // Handle upgrade success/cancelled states
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const upgradeStatus = urlParams.get('upgrade');
    
    if (upgradeStatus === 'success') {
      // Show success message and refresh data
      refreshData();
      // Show welcome modal
      setShowWelcomeProModal(true);
      // Clear the URL parameter
      navigate(location.pathname, { replace: true });
    } else if (upgradeStatus === 'cancelled') {
      // Show cancelled message
      // Clear the URL parameter
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, refreshData, navigate, location.pathname]);

  // Handle refresh when navigating from prompts modal
  useEffect(() => {
    if (justFinishedOnboarding) {
      refreshData();
      // Clear the state to prevent unnecessary refreshes
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [justFinishedOnboarding, location.pathname, refreshData, navigate]);

  // Handle URL-based navigation to update active section and group
  useEffect(() => {
    const path = location.pathname;
    
    // Map URL paths to sections and groups
    if (path === '/dashboard') {
      setActiveGroup('dashboard');
      setActiveSection('overview');
    } else if (path === '/monitor') {
      setActiveGroup('monitor');
      setActiveSection('prompts');
    } else if (path === '/monitor/responses') {
      setActiveGroup('monitor');
      setActiveSection('responses');
    } else if (path === '/analyze') {
      setActiveGroup('analyze');
      setActiveSection('talentx');
    } else if (path === '/analyze/answer-gaps') {
      setActiveGroup('analyze');
      setActiveSection('answer-gaps');
    } else if (path === '/analyze/reports') {
      setActiveGroup('analyze');
      setActiveSection('reports');
    }
  }, [location.pathname]);

  // Handle section changes within the dashboard
  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    
    // Update group based on section
    if (['overview', 'sources', 'competitors'].includes(section)) {
      setActiveGroup('dashboard');
    } else if (['prompts', 'responses'].includes(section)) {
      setActiveGroup('monitor');
    } else if (['talentx', 'answer-gaps', 'reports'].includes(section)) {
      setActiveGroup('analyze');
    }
  };

  // Onboarding check: skip if just finished onboarding
  useEffect(() => {
    if (justFinishedOnboarding) {
      setIsLoading(true); // Show skeleton until data loads
      return;
    }
    const checkOnboardingStatus = async () => {
      if (!user) return;

      try {
        // Check if user has completed onboarding
        const { data: onboardingData, error: onboardingError } = await supabase
          .from('user_onboarding')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (onboardingError) throw onboardingError;

        // If no onboarding data exists, show onboarding modal
        if (!onboardingData || onboardingData.length === 0) {
          setIsNewUser(true);
          // setShowPromptsModal(true); // Removed as per edit hint
        } else {
          // If onboarding exists but no prompts, show prompts modal
          const { data: promptsData, error: promptsError } = await (supabase as any)
            .from('confirmed_prompts')
            .select('*')
            .eq('onboarding_id', onboardingData[0].id);

          if (promptsError) throw promptsError;

          if (!promptsData || promptsData.length === 0) {
            setOnboardingData(transformOnboardingData(onboardingData[0]));
            setOnboardingId(onboardingData[0].id);
            // setShowPromptsModal(true); // Removed as per edit hint
          }
        }
      } catch (error) {
        console.error('Error checking onboarding status:', error);
        setError('Failed to check onboarding status');
      } finally {
        setIsLoading(false);
      }
    };

    checkOnboardingStatus();
  }, [user, justFinishedOnboarding]);

  useEffect(() => {
    // Check for answer gaps data in sessionStorage
    const storedData = sessionStorage.getItem('answerGapsData');
    if (storedData) {
      try {
        setAnswerGapsData(JSON.parse(storedData));
      } catch (error) {
        console.error('Error parsing answer gaps data:', error);
      }
    }

    // Listen for storage changes to update answer gaps data
    const handleStorageChange = () => {
      const newData = sessionStorage.getItem('answerGapsData');
      if (newData) {
        try {
          setAnswerGapsData(JSON.parse(newData));
        } catch (error) {
          console.error('Error parsing answer gaps data:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    // If navigation state requests to show prompts modal, do so and set onboarding data
    if (location.state?.showPromptsModal) {
      // setShowPromptsModal(true); // Removed as per edit hint
      if (location.state.onboardingData) {
        setOnboardingData(location.state.onboardingData);
        setOnboardingId(location.state.onboardingData.id || null);
      }
      // Clear the navigation state so modal doesn't reopen on refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    // Only fetch onboarding status if onboardingData is not already set from navigation state
    if (onboardingData) {
      // Check if there are any confirmed prompts OR responses for this onboarding record
      const checkPromptsAndResponses = async () => {
        if (!onboardingData.id) return;
        // 1. Get all confirmed prompts for this onboarding
        const { data: promptsData, error: promptsError } = await (supabase as any)
          .from('confirmed_prompts')
          .select('id')
          .eq('onboarding_id', onboardingData.id);
        if (promptsError) {
          console.error('Error checking prompts:', promptsError);
          return;
        }
        if (!promptsData || promptsData.length === 0) {
          // setShowPromptsModal(true); // Removed as per edit hint
          return;
        }
        // 2. Get all prompt_responses for these prompt IDs
        const promptIds = promptsData.map((p: any) => p.id);
        if (promptIds.length === 0) {
          // setShowPromptsModal(true); // Removed as per edit hint
          return;
        }
        const { data: responsesData, error: responsesError } = await (supabase as any)
          .from('prompt_responses')
          .select('id')
          .in('confirmed_prompt_id', promptIds);
        if (responsesError) {
          console.error('Error checking responses:', responsesError);
          return;
        }
        if (!responsesData || responsesData.length === 0) {
          // setShowPromptsModal(true); // Removed as per edit hint
        }
      };
      checkPromptsAndResponses();
      setIsLoading(false);
      return;
    } else if (user) {
      // Fetch onboarding data if not set
      const fetchOnboardingData = async () => {
        const { data, error } = await (supabase as any)
          .from('user_onboarding')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) {
          console.error('Error fetching onboarding data:', error);
          return;
        }
        if (data && data.length > 0) {
          setOnboardingData({
            companyName: data[0].company_name,
            industry: data[0].industry,
            id: data[0].id
          });
        }
      };
      fetchOnboardingData();
    }
  }, [onboardingData, user]);

  useEffect(() => {
    // If just finished onboarding, mark prompts as completed
    if (justFinishedOnboarding && onboardingId) {
      setPromptsCompleted(onboardingId);
      setHasDismissedPromptsModal(false); // Reset dismissed state when setup is completed
    }
  }, [justFinishedOnboarding, onboardingId]);

  // Reset dismissed state if user has completed prompts
  useEffect(() => {
    if (onboardingId && hasCompletedPrompts(onboardingId)) {
      setHasDismissedPromptsModal(false);
    }
  }, [onboardingId]);

  const renderBlurredSection = (sectionName: string, description: string, children: React.ReactNode) => {
    return (
      <div className="relative">
        {/* Blurred content */}
        <div className="blur-sm pointer-events-none">
          {children}
        </div>
        
        {/* Upgrade overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-lg max-w-md text-center">
            <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-r from-[#13274F] to-[#0DBCBA] rounded-full mx-auto mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{sectionName}</h2>
            <p className="text-gray-600 mb-6">{description}</p>
            <Button 
              onClick={() => setShowUpgradeModal(true)}
              className="bg-gradient-to-r from-[#13274F] to-[#0DBCBA] text-white hover:from-[#0F1F3D] hover:to-[#0BA8A6]"
            >
              Upgrade to Pro
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderSetupBlurredOverview = (children: React.ReactNode) => {
    return (
      <div className="relative">
        {/* Blurred content */}
        <div className="blur-sm pointer-events-none">
          {children}
        </div>
        
        {/* Setup overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-lg max-w-md text-center">
            <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-r from-[#13274F] to-[#0DBCBA] rounded-full mx-auto mb-6">
              <Target className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Complete Your Setup</h2>
            <p className="text-gray-600 mb-6">Finish setting up your monitoring strategy to see your dashboard insights.</p>
            <Button 
              onClick={() => {
                // setShowPromptsModal(true); // Removed as per edit hint
                setHasDismissedPromptsModal(false); // Reset dismissed state when user chooses to continue
              }}
              className="bg-gradient-to-r from-[#13274F] to-[#0DBCBA] text-white hover:from-[#0F1F3D] hover:to-[#0BA8A6]"
            >
              Continue Setup
            </Button>
          </div>
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
        case "sources":
          return <div className="animate-pulse">Loading sources...</div>;
        case "competitors":
          return <div className="animate-pulse">Loading competitors...</div>;
        case "talentx":
          return <div className="animate-pulse">Loading TalentX analysis...</div>;
        case "answer-gaps":
          return <AnswerGapsSkeleton />;
        case "reports":
          return <ReportsSkeleton />;
        default:
          return <OverviewSkeleton />;
      }
    }

    switch (activeSection) {
      case "overview":
        const overviewContent = (
          <OverviewTab 
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            responses={responses}
            competitorLoading={competitorLoading}
            companyName={companyName}
            llmMentionRankings={llmMentionRankings}
            talentXProData={talentXProData}
            isPro={isPro}
          />
        );
        
        // Show blurred overview if user dismissed prompts modal and hasn't completed setup
        if (hasDismissedPromptsModal && onboardingData && !hasCompletedPrompts(onboardingId)) {
          return renderSetupBlurredOverview(overviewContent);
        }
        
        return overviewContent;
      case "prompts":
        return (
          <PromptsTab 
            promptsData={promptsData} 
            responses={responses}
          />
        );
      case "responses":
        return (
          <ResponsesTab 
            responses={responses}
            parseCitations={parseCitations}
          />
        );
      case "sources":
        const sourcesContent = (
          <SourcesTab 
            topCitations={topCitations}
            responses={responses}
            parseCitations={parseCitations}
          />
        );
        return sourcesContent;
      case "competitors":
        const competitorsContent = (
          <CompetitorsTab 
            topCompetitors={topCompetitors}
            responses={responses}
            companyName={companyName}
          />
        );
        return competitorsContent;
      case "talentx":
        const talentXContent = (
          <TalentXTab 
            talentXData={talentXData}
            isProUser={isPro}
            companyName={companyName}
            industry={onboardingData?.industry || 'Technology'}
          />
        );
        return (
          <div className="relative min-h-[600px]">
            {/* Overlay for Coming Soon */}
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
              <div className="text-center p-8 max-w-lg mx-auto">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">TalentX Attributes (Coming Soon)</h2>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  This feature will provide detailed analysis of how your company performs across key talent attraction attributes. 
                  Get insights into mission & purpose, company culture, rewards & recognition, and more to improve your employer brand.
                </p>
                <span className="inline-block bg-yellow-400 text-yellow-900 px-4 py-2 rounded-full font-semibold text-sm">Coming Soon</span>
              </div>
            </div>
            {/* Blurred/disabled content underneath */}
            <div className="blur-sm pointer-events-none select-none opacity-60">
              {talentXContent}
            </div>
          </div>
        );
      case "answer-gaps":
        const answerGapsContent = <AnswerGapsTab />;
        return (
          <div className="relative min-h-[600px]">
            {/* Overlay for Coming Soon */}
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
              <div className="text-center p-8 max-w-lg mx-auto">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">Answer Gaps Analysis (Coming Soon)</h2>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  This feature will help you identify gaps in your content and discover opportunities for improvement. 
                  Get insights into what questions AI can't answer about your company and how to address them.
                </p>
                <span className="inline-block bg-yellow-400 text-yellow-900 px-4 py-2 rounded-full font-semibold text-sm">Coming Soon</span>
              </div>
            </div>
            {/* Blurred/disabled content underneath */}
            <div className="blur-sm pointer-events-none select-none opacity-60">
              {answerGapsContent}
            </div>
          </div>
        );
      case "reports":
        const reportsContent = (
          <ReportGenerator
            companyName={companyName}
            metrics={metrics}
            responses={responses}
            sentimentTrend={sentimentTrend}
            topCitations={topCitations}
            promptsData={promptsData}
            answerGapsData={answerGapsData}
          />
        );
        return (
          <div className="relative min-h-[600px]">
            {/* Overlay for Coming Soon */}
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
              <div className="text-center p-8 max-w-lg mx-auto">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">Report Generator (Coming Soon)</h2>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  This feature will allow you to generate comprehensive reports about your AI perception and performance. 
                  Create detailed insights and analytics to share with your team and stakeholders.
                </p>
                <span className="inline-block bg-yellow-400 text-yellow-900 px-4 py-2 rounded-full font-semibold text-sm">Coming Soon</span>
              </div>
            </div>
            {/* Blurred/disabled content underneath */}
            <div className="blur-sm pointer-events-none select-none opacity-60">
              {reportsContent}
            </div>
          </div>
        );
      default:
        return (
          <OverviewTab 
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            responses={responses}
            competitorLoading={competitorLoading}
            companyName={companyName}
            llmMentionRankings={llmMentionRankings}
            talentXProData={talentXProData}
            isPro={isPro}
          />
        );
    }
  };

  // Sidebar width variables
  const sidebarWidth = isMobile ? 0 : state === "collapsed" ? "4rem" : "16rem";

  // Helper to get breadcrumb label for each section
  const getBreadcrumbLabel = (section) => {
    switch (section) {
      case "overview":
        return "Overview";
      case "responses":
        return "Responses";
      case "prompts":
        return "Prompts";
      case "sources":
        return "Sources";
      case "competitors":
        return "Competitors";
      case "talentx":
        return "TalentX";
      case "answer-gaps":
        return "Answer Gaps";
      case "reports":
        return "Reports";
      default:
        return "Overview";
    }
  };

  // Helper to get group label
  const getGroupLabel = (group) => {
    switch (group) {
      case "dashboard":
        return "Dashboard";
      case "monitor":
        return "Monitoring";
      case "analyze":
        return "Analyze";
      default:
        return "Dashboard";
    }
  };

  const breadcrumbs = useMemo(() => {
    // Handle group-based breadcrumbs
    if (activeGroup === "dashboard" && activeSection === "overview") {
      return [
        { label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, active: true }
      ];
    }
    
    if (activeGroup === "dashboard") {
      return [
        { label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" />, active: false },
        { label: getBreadcrumbLabel(activeSection), icon: null, active: true }
      ];
    }
    
    // For monitor and analyze groups
    return [
      { label: getGroupLabel(activeGroup), icon: <LayoutDashboard className="w-4 h-4" />, active: false },
      { label: getBreadcrumbLabel(activeSection), icon: null, active: true }
    ];
  }, [activeSection, activeGroup]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-900 mb-2">Error</h2>
          <p className="text-red-700 mb-4">{error}</p>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-red-600 hover:bg-red-700"
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full flex flex-row">
      <div
        className="transition-all duration-200 h-full"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      >
        <AppSidebar 
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />
      </div>
      <div className="flex-1 min-w-0">
        <SidebarInset>
          <DashboardHeader 
            companyName={companyName}
            responsesCount={responses.length}
            onRefresh={refreshData}
            breadcrumbs={breadcrumbs}
            lastUpdated={lastUpdated}
            onFixData={fixExistingPrompts}
            hasDataIssues={hasDataIssues}
          />

          <div className="flex-1 space-y-4 p-8">
            <div className="mb-8">
              {/* Dashboard Title, LLM Logos (right-aligned only for overview), and Subtitle */}
              <div className="flex items-center justify-between mb-1 w-full">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 whitespace-nowrap">
                    {activeSection === "responses" ? "Responses" :
                     activeSection === "prompts" ? "Prompts" :
                     activeSection === "sources" ? "Sources" :
                     activeSection === "competitors" ? "Competitors" :
                     activeSection === "talentx" ? "TalentX Analysis" :
                     activeSection === "answer-gaps" ? "Answer Gaps Analysis" :
                     activeSection === "reports" ? "Reports" : "Dashboard"}
                  </h1>
                  <p className="text-gray-600">
                    {activeSection === "responses"
                      ? "Manage and monitor all the individual responses for your prompts."
                      : activeSection === "prompts"
                      ? "Manage and monitor your AI prompts across different categories."
                      : activeSection === "sources"
                      ? "Analyze the sources influencing how AI sees your employer brand."
                      : activeSection === "competitors"
                      ? "Analyze the companies competing with you for talent."
                      : activeSection === "talentx"
                      ? "Analyze how your company performs across key talent attraction attributes."
                      : activeSection === "answer-gaps"
                      ? "Analyze and identify gaps in AI responses about your company."
                      : activeSection === "reports"
                      ? "Generate comprehensive reports about your AI perception and performance."
                      : `Overview of ${companyName}'s AI employer reputation.`}
                  </p>
                </div>
                {/* LLM Logos right-aligned only for overview */}
                {activeSection === "overview" && (
                  <div className="flex flex-row items-center gap-2 flex-nowrap hide-on-mobile">
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
                    <div 
                      className={`flex items-center px-2 py-1 rounded-lg ${isPro ? 'bg-gray-100/80' : 'bg-gray-100/80 opacity-60'} ${!isPro ? 'cursor-pointer hover:bg-gray-200/80 transition-colors' : ''}`}
                      onClick={!isPro ? () => setShowUpgradeModal(true) : undefined}
                    >
                      <LLMLogo modelName="deepseek" size="sm" className="mr-1" />
                      <span className="text-sm text-gray-700">DeepSeek</span>
                      {!isPro && <Lock className="w-3 h-3 ml-1 text-gray-500" />}
                    </div>
                    <div 
                      className={`flex items-center px-2 py-1 rounded-lg ${isPro ? 'bg-gray-100/80' : 'bg-gray-100/80 opacity-60'} ${!isPro ? 'cursor-pointer hover:bg-gray-200/80 transition-colors' : ''}`}
                      onClick={!isPro ? () => setShowUpgradeModal(true) : undefined}
                    >
                      <LLMLogo modelName="google-ai-overviews" size="sm" className="mr-1" />
                      <span className="text-sm text-gray-700">Google AI</span>
                      {!isPro && <Lock className="w-3 h-3 ml-1 text-gray-500" />}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-8">
              {renderActiveSection()}
            </div>
          </div>
        </SidebarInset>
      </div>

      {/* Modals */}
      <UpgradeModal open={showUpgradeModal} onOpenChange={setShowUpgradeModal} />
      <WelcomeProModal open={showWelcomeProModal} onOpenChange={setShowWelcomeProModal} />
    </div>
  );
};

const Dashboard = ({ defaultGroup, defaultSection }: DashboardProps = {}) => (
  <SidebarProvider>
    <DashboardContent defaultGroup={defaultGroup} defaultSection={defaultSection} />
  </SidebarProvider>
);

export default Dashboard;
