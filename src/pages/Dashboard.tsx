import { useState, useEffect } from 'react';
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
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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

const DashboardContent = () => {
  const {
    responses,
    loading,
    companyName,
    metrics,
    sentimentTrend,
    topCitations,
    promptsData,
    refreshData,
    parseCitations,
    popularThemes
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

  useEffect(() => {
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
  }, [user]);

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

  if (loading) {
    return <LoadingSpinner text="Loading dashboard data..." />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

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

  const renderActiveSection = () => {
    switch (activeSection) {
      case "overview":
        return (
          <OverviewTab 
            metrics={metrics}
            sentimentTrend={sentimentTrend}
            topCitations={topCitations}
            popularThemes={popularThemes}
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
            sentimentTrend={sentimentTrend}
            topCitations={topCitations}
            popularThemes={popularThemes}
          />
        );
    }
  };

  // Sidebar width variables
  const sidebarWidth = isMobile ? 0 : state === "collapsed" ? "4rem" : "16rem";

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
          />

          <div className="flex-1 space-y-4 p-8">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {activeSection === "responses" ? "AI Responses" :
                 activeSection === "prompts" ? "Prompt Library" :
                 activeSection === "answer-gaps" ? "Answer Gaps Analysis" :
                 activeSection === "reports" ? "Reports" : "Dashboard"}
              </h1>
              <p className="text-gray-600">
                {activeSection === "responses"
                  ? "View and analyze responses from different AI models."
                  : activeSection === "prompts"
                  ? "Manage and monitor your AI prompts across different categories."
                  : activeSection === "answer-gaps"
                  ? "Analyze and identify gaps in AI responses about your company."
                  : activeSection === "reports"
                  ? "Generate comprehensive reports about your AI perception and performance."
                  : `Overview of your project's performance and AI interactions for ${companyName}.`}
              </p>
            </div>
            <div className="space-y-8">
              {renderActiveSection()}
            </div>
          </div>
        </SidebarInset>
      </div>
      {/* Prompts Modal */}
      <PromptsModal
        open={showPromptsModal}
        onOpenChange={setShowPromptsModal}
        onboardingData={onboardingData || undefined}
      />
      {/* Onboarding Modal */}
      <OnboardingModal
        open={showOnboardingModal}
        onOpenChange={setShowOnboardingModal}
      />
    </div>
  );
};

const Dashboard = () => (
  <SidebarProvider>
    <DashboardContent />
  </SidebarProvider>
);

export default Dashboard;
