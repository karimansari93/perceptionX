// This page is no longer shown after onboarding. All onboarding redirects go directly to /auth for account creation.

import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import UserMenu from "@/components/UserMenu";
import { PromptsTable } from "@/components/prompts/PromptsTable";
import { PromptStrategyExplanation } from "@/components/prompts/PromptStrategyExplanation";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { LoadingModal } from "@/components/prompts/LoadingModal";
import { usePromptsLogic } from "@/hooks/usePromptsLogic";

interface OnboardingData {
  companyName: string;
  industry: string;
  hiringChallenges: string[];
  targetRoles: string[];
  currentStrategy: string;
  talentCompetitors: string[];
}

const Prompts = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingData = location.state?.onboardingData as OnboardingData;

  const {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring
  } = usePromptsLogic(onboardingData);

  // Show error state if there's an error
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <header className="border-b bg-white/80 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
            <Button 
              variant="ghost" 
              onClick={() => navigate('/onboarding')}
              className="flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Onboarding
            </Button>
            <h1 className="text-xl font-semibold">Error</h1>
            <UserMenu />
          </div>
        </header>

        <div className="container mx-auto px-6 py-8">
          <Card className="max-w-2xl mx-auto bg-red-50 border-red-200">
            <CardContent className="p-6 text-center">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-red-900 mb-2">Setup Error</h2>
              <p className="text-red-700 mb-4">{error}</p>
              <Button 
                onClick={() => navigate('/onboarding')}
                className="bg-red-600 hover:bg-red-700"
              >
                Start Over
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Show loading state while checking onboarding
  if (!onboardingRecord && !error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Setting up your prompts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={() => navigate('/onboarding')}
              className="flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Onboarding
            </Button>
            <h1 className="text-xl font-semibold">Recommended Prompts</h1>
          </div>
          <div className="flex items-center gap-4">
            <ConfirmationCard 
              isConfirming={isConfirming}
              onConfirm={confirmAndStartMonitoring}
              disabled={!onboardingRecord}
            />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <PromptsTable prompts={prompts} />
          
          <PromptStrategyExplanation />
        </div>
      </div>

      {/* Loading Modal */}
      <LoadingModal
        isOpen={isConfirming}
        currentModel={progress.currentModel}
        currentPrompt={progress.currentPrompt}
        completed={progress.completed}
        total={progress.total}
      />
    </div>
  );
};

export default Prompts;
