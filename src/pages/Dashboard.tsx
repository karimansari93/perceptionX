import { useState, useEffect, useMemo } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { PromptsTab } from "@/components/dashboard/PromptsTab";
import { ResponsesTab } from "@/components/dashboard/ResponsesTab";
import { AnswerGapsTab } from "@/components/dashboard/AnswerGapsTab";
import { ReportGenerator } from "@/components/dashboard/ReportGenerator";
import { AppSidebar } from "@/components/AppSidebar";
import { PromptsModal } from "@/components/prompts/PromptsModal";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronRight, LayoutDashboard } from "lucide-react";
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

const DashboardContent = () => {
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
    topCompetitors
  } = useDashboardData();

  const [answerGapsData, setAnswerGapsData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState("overview");
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showPromptsModal, setShowPromptsModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [onboardingData, setOnboardingData] = useState<PromptsModalOnboardingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const justFinishedOnboarding = !!location.state?.shouldRefresh;

  // Handle refresh when navigating from prompts modal
  useEffect(() => {
    if (justFinishedOnboarding) {
      refreshData();
      // Clear the state to prevent unnecessary refreshes
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [justFinishedOnboarding, location.pathname, refreshData, navigate]);

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
          setShowOnboardingModal(true);
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
            setShowPromptsModal(true);
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
      setShowPromptsModal(true);
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
          setShowPromptsModal(true);
          return;
        }
        // 2. Get all prompt_responses for these prompt IDs
        const promptIds = promptsData.map((p: any) => p.id);
        if (promptIds.length === 0) {
          setShowPromptsModal(true);
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
          setShowPromptsModal(true);
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
    }
  }, [justFinishedOnboarding, onboardingId]);

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

    switch (activeSection) {
      case "overview":
        return (
          <OverviewTab 
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            responses={responses}
            competitorLoading={competitorLoading}
          />
        );
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
      case "answer-gaps":
        return <AnswerGapsTab />;
      case "reports":
        return (
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
      default:
        return (
          <OverviewTab 
            metrics={metrics}
            topCitations={topCitations}
            topCompetitors={topCompetitors}
            responses={responses}
            competitorLoading={competitorLoading}
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
        return "Dashboard";
      case "responses":
        return "Responses";
      case "prompts":
        return "Prompts";
      case "answer-gaps":
        return "Answer Gaps";
      case "reports":
        return "Reports";
      default:
        return "Dashboard";
    }
  };

  const breadcrumbs = useMemo(() => {
    // Only two-level for now: Dashboard > Section
    if (activeSection === "overview") {
      return [
        { label: "Dashboard", icon: LayoutDashboard, active: true }
      ];
    }
    return [
      { label: "Dashboard", icon: LayoutDashboard, active: false },
      { label: getBreadcrumbLabel(activeSection), icon: null, active: true }
    ];
  }, [activeSection]);

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
          onSectionChange={setActiveSection}
        />
      </div>
      <div className="flex-1 min-w-0">
        <SidebarInset>
          <DashboardHeader 
            companyName={companyName}
            responsesCount={responses.length}
            onRefresh={refreshData}
            breadcrumbs={breadcrumbs}
          />

          <div className="flex-1 space-y-4 p-8">
            <div className="mb-8">
              {/* Dashboard Title, LLM Logos (right-aligned only for overview), and Subtitle */}
              <div className="flex items-center justify-between mb-1 w-full">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 whitespace-nowrap">
                    {activeSection === "responses" ? "Responses" :
                     activeSection === "prompts" ? "Prompts" :
                     activeSection === "answer-gaps" ? "Answer Gaps Analysis" :
                     activeSection === "reports" ? "Reports" : "Dashboard"}
                  </h1>
                  <p className="text-gray-600">
                    {activeSection === "responses"
                      ? "Manage and monitor all the individual responses for your prompts."
                      : activeSection === "prompts"
                      ? "Manage and monitor your AI prompts across different categories."
                      : activeSection === "answer-gaps"
                      ? "Analyze and identify gaps in AI responses about your company."
                      : activeSection === "reports"
                      ? "Generate comprehensive reports about your AI perception and performance."
                      : `Overview of your project's performance and AI interactions for ${companyName}.`}
                  </p>
                </div>
                {/* LLM Logos right-aligned only for overview */}
                {activeSection === "overview" && (
                  <div className="flex flex-row items-center gap-2 flex-nowrap">
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
      {showPromptsModal && (
        <PromptsModal
          open={showPromptsModal}
          onOpenChange={setShowPromptsModal}
          onboardingData={onboardingData}
        />
      )}
      {showOnboardingModal && (
        <OnboardingModal
          open={showOnboardingModal}
          onOpenChange={setShowOnboardingModal}
        />
      )}
    </div>
  );
};

const Dashboard = () => (
  <SidebarProvider>
    <DashboardContent />
  </SidebarProvider>
);

export default Dashboard;
