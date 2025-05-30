import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PromptsTable } from "@/components/prompts/PromptsTable";
import { PromptStrategyExplanation } from "@/components/prompts/PromptStrategyExplanation";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { LoadingModal } from "@/components/prompts/LoadingModal";
import { usePromptsLogic } from "@/hooks/usePromptsLogic";

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
  console.log('PromptsModal onboardingData:', onboardingData);
  const navigate = useNavigate();
  const location = useLocation();

  const {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring
  } = usePromptsLogic(onboardingData);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">Prompts Setup</DialogTitle>
        <DialogDescription className="sr-only">
          Review and confirm your AI prompts for monitoring
        </DialogDescription>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Button 
              variant="ghost" 
              onClick={() => onOpenChange(false)}
              className="flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <ConfirmationCard 
              isConfirming={isConfirming}
              onConfirm={confirmAndStartMonitoring}
              disabled={!onboardingRecord}
            />
          </div>

          <div className="space-y-8">
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
      </DialogContent>
    </Dialog>
  );
}; 