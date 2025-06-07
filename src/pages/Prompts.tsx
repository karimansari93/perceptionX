// This page is no longer shown after onboarding. All onboarding redirects go directly to /auth for account creation.

import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import UserMenu from "@/components/UserMenu";
import { PromptsTable, PromptsHeader } from "@/components/prompts/PromptsTable";
import { PromptStrategyExplanation } from "@/components/prompts/PromptStrategyExplanation";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { LoadingModal } from "@/components/prompts/LoadingModal";
import { usePromptsLogic } from "@/hooks/usePromptsLogic";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface OnboardingData {
  companyName: string;
  industry: string;
}

const Prompts = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(location.state?.onboardingData || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!onboardingData && user) {
      setLoading(true);
      supabase
        .from('user_onboarding')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (data && data.length > 0) {
            setOnboardingData({
              companyName: data[0].company_name,
              industry: data[0].industry,
            });
          }
          setLoading(false);
        });
    }
  }, [onboardingData, user]);

  const {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring
  } = usePromptsLogic(onboardingData || undefined);

  if (loading || (!onboardingData && user)) {
    return (
      <div className="min-h-screen ..." style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading company info...</p>
        </div>
      </div>
    );
  }

  // Show error state if there's an error
  if (error) {
    return (
      <div className="min-h-screen ..." style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <header className="border-b bg-white/80 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
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
                onClick={() => navigate('/dashboard')}
                className="bg-red-600 hover:bg-red-700"
              >
                Return to Dashboard
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
      <div className="min-h-screen ..." style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Setting up your prompts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen ..." style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between max-w-6xl">
          <div className="flex items-center gap-4">
            {/* No more back to onboarding */}
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
          <PromptsHeader companyName={onboardingData?.companyName} />
          <PromptsTable prompts={prompts} companyName={onboardingData?.companyName} />
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
