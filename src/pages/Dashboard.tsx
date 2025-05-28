import { useState, useEffect } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { PromptsTab } from "@/components/dashboard/PromptsTab";
import { ResponsesTab } from "@/components/dashboard/ResponsesTab";
import { CitationsTab } from "@/components/dashboard/CitationsTab";
import { AnswerGapsTab } from "@/components/dashboard/AnswerGapsTab";
import { ReportGenerator } from "@/components/dashboard/ReportGenerator";
import { AppSidebar } from "@/components/AppSidebar";

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
    parseCitations
  } = useDashboardData();

  const [answerGapsData, setAnswerGapsData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState("overview");
  const { state, isMobile } = useSidebar();

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

  if (loading) {
    return <LoadingSpinner text="Loading dashboard data..." />;
  }

  const renderActiveSection = () => {
    switch (activeSection) {
      case "overview":
        return (
          <OverviewTab 
            metrics={metrics}
            sentimentTrend={sentimentTrend}
            topCitations={topCitations}
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
                 activeSection === "answer-gaps" ? "Answer Gaps Analysis" : "Dashboard"}
              </h1>
              <p className="text-gray-600">
                {activeSection === "responses" 
                  ? "View and analyze responses from different AI models."
                  : activeSection === "prompts"
                  ? "Manage and monitor your AI prompts across different categories."
                  : activeSection === "answer-gaps"
                  ? "Analyze and identify gaps in AI responses about your company."
                  : `Overview of your project's performance and AI interactions for ${companyName}.`
                }
              </p>
            </div>

            <div className="space-y-8">
              {renderActiveSection()}
            </div>
          </div>
        </SidebarInset>
      </div>
    </div>
  );
};

const Dashboard = () => (
  <SidebarProvider>
    <DashboardContent />
  </SidebarProvider>
);

export default Dashboard;
