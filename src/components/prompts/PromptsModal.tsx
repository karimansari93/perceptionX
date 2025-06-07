import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PromptsTable, PromptsHeader } from "@/components/prompts/PromptsTable";
import { PromptStrategyExplanation } from "@/components/prompts/PromptStrategyExplanation";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { LoadingModal } from "@/components/prompts/LoadingModal";
import { usePromptsLogic } from "@/hooks/usePromptsLogic";
import { useEffect } from "react";

interface OnboardingData {
  companyName: string;
  industry: string;
}

interface PromptsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onboardingData?: OnboardingData;
}

export const PromptsModal = ({ open, onOpenChange, onboardingData }: PromptsModalProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring,
    setIsConfirming
  } = usePromptsLogic(onboardingData);

  // Navigate to dashboard when loading completes
  useEffect(() => {
    if (isConfirming && progress.completed === progress.total && progress.total > 0) {
      // Add a small delay to ensure the loading modal shows completion
      setTimeout(() => {
        navigate('/dashboard', { 
          state: { 
            shouldRefresh: true,
            onboardingData 
          }
        });
      }, 1000);
    }
  }, [isConfirming, progress.completed, progress.total, navigate, onboardingData]);

  // If onboardingRecord or onboardingData is missing, don't show the modal
  if (!onboardingRecord || !onboardingData) {
    return null;
  }

  // Show loading state while checking onboarding
  if (!onboardingRecord && !error) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">Loading</DialogTitle>
          <DialogDescription className="sr-only">
            Setting up your prompts
          </DialogDescription>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Setting up your prompts...</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open && !isConfirming} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto pb-28">
          <DialogTitle className="sr-only">Prompts Setup</DialogTitle>
          <DialogDescription className="sr-only">
            Review and confirm yor AI prompts for monitoring
          </DialogDescription>
          <div className="space-y-6">
            <div className="space-y-8">
              <PromptsHeader companyName={onboardingData.companyName} />
              <PromptsTable prompts={prompts} companyName={onboardingData.companyName} />
              <PromptStrategyExplanation />
            </div>
          </div>
          <div className="fixed left-0 right-0 bottom-0 z-50 flex justify-center pb-6 pointer-events-none">
            <div className="pointer-events-auto w-full px-6">
              <ConfirmationCard 
                isConfirming={isConfirming}
                onConfirm={confirmAndStartMonitoring}
                disabled={!onboardingRecord}
                className="w-full"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Loading Modal */}
      <LoadingModal
        isOpen={isConfirming}
        currentModel={progress.currentModel}
        currentPrompt={progress.currentPrompt}
        completed={progress.completed}
        total={progress.total}
        showResultsButton={true}
        onClose={() => setIsConfirming(false)}
      />
    </>
  );
}; 