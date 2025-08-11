import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Database } from '@/integrations/supabase/types';
import { usePromptsLogic } from "@/hooks/usePromptsLogic";
import { PromptsTable } from "@/components/prompts/PromptsTable";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { LoadingModal } from "@/components/prompts/LoadingModal";

type UserOnboarding = Database['public']['Tables']['user_onboarding']['Insert'];

interface OnboardingData {
  display_name: string;
  company_name: string;
  industry: string;
}

interface DatabaseOnboardingData {
  company_name: string;
  industry: string;
  user_id?: string;
  session_id?: string;
  created_at?: string;
  id?: string;
}

interface OnboardingStep {
  title: string;
  description: string;
  fields: Array<{
    label: string;
    type: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  }>;
  isWelcomeStep?: boolean;
  isPromptsStep?: boolean;
}

interface OnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const OnboardingModal = ({ open, onOpenChange }: OnboardingModalProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    display_name: "",
    company_name: "",
    industry: ""
  });
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);

  // Prompts logic
  const [onboardingDataForPrompts, setOnboardingDataForPrompts] = useState<{
    companyName: string;
    industry: string;
  } | null>(null);

  // Local prompts state for display
  const [localPrompts, setLocalPrompts] = useState<Array<{
    id: string;
    text: string;
    category: string;
    type: string;
  }>>([]);

  // State for showing how it works
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const {
    prompts,
    isConfirming,
    onboardingRecord,
    error: promptsError,
    progress,
    confirmAndStartMonitoring,
    setIsConfirming
  } = usePromptsLogic(onboardingDataForPrompts);

  // Check if user needs to provide display name
  useEffect(() => {
    if (user && open) {
      setNeedsDisplayName(!user.user_metadata?.full_name && !user.user_metadata?.name);
      // Pre-fill display name if available
      const existingName = user.user_metadata?.full_name || user.user_metadata?.name || "";
      setOnboardingData(prev => ({ ...prev, display_name: existingName }));
    }
  }, [user, open]);

  // Generate prompts when reaching the prompts step
  useEffect(() => {
    if (onboardingStep === 2 && onboardingDataForPrompts && localPrompts.length === 0) {
      // Generate prompts for display
      const basePrompts = [
        {
          id: 'sentiment-1',
          text: `How is ${onboardingDataForPrompts.companyName} as an employer?`,
          category: 'Employer Reputation',
          type: 'sentiment'
        },
        {
          id: 'visibility-1',
          text: `What is the best company to work for in the ${onboardingDataForPrompts.industry} industry?`,
          category: 'Industry Leaders',
          type: 'visibility'
        },
        {
          id: 'competitive-1',
          text: `How does working at ${onboardingDataForPrompts.companyName} compare to other companies in the ${onboardingDataForPrompts.industry} industry?`,
          category: 'Competitive Analysis',
          type: 'competitive'
        }
      ];
      
      setLocalPrompts(basePrompts);
    }
  }, [onboardingStep, onboardingDataForPrompts, localPrompts.length]);

  const onboardingSteps: OnboardingStep[] = [
    {
      title: "Welcome to the PerceptionX Beta! 🎉",
      description: "You're joining an exclusive group of early users helping us shape the future of employer perception analysis. Let's get you started!",
      fields: [],
      isWelcomeStep: true
    },
    {
      title: "Company details",
      description: "We just need some basic information about you and your company.",
      fields: [
        ...(needsDisplayName ? [{
          label: "Your Name",
          type: "text",
          placeholder: "Enter your full name",
          value: onboardingData.display_name,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, display_name: value }))
        }] : []),
        {
          label: "Company",
          type: "text",
          placeholder: "Enter your company name",
          value: onboardingData.company_name,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, company_name: value }))
        },
        {
          label: "Industry",
          type: "text",
          placeholder: "e.g., Software or Healthcare",
          value: onboardingData.industry,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, industry: value }))
        }
      ]
    },
    {
      title: "Let's setup your monitoring strategy",
      description: "We'll test how different AI models respond to three key questions about your company as an employer. This takes about 2 minutes to complete.",
      fields: [],
      isPromptsStep: true
    }
  ];

  const handleNext = async () => {
    // Skip validation for welcome step
    if (onboardingStep === 0 && onboardingSteps[0].isWelcomeStep) {
      setOnboardingStep(prev => prev + 1);
      return;
    }

    // Handle moving from company info to prompts step
    if (onboardingStep === 1) {
      // Validate required fields
      const requiredFields = needsDisplayName 
        ? [onboardingData.display_name, onboardingData.company_name, onboardingData.industry]
        : [onboardingData.company_name, onboardingData.industry];
      
      if (requiredFields.some(field => !field.trim())) {
        toast.error('Please fill in all required fields before continuing');
        return;
      }

      // Save onboarding data before moving to prompts step
      try {
        const newRecord: UserOnboarding = {
          user_id: user?.id,
          company_name: onboardingData.company_name,
          industry: onboardingData.industry,
          session_id: `session_${user?.id}_${Date.now()}`
        };

        const { data, error } = await supabase
          .from('user_onboarding')
          .insert(newRecord)
          .select()
          .single();

        if (error) throw error;

        // Update user's display name in auth if needed
        if (needsDisplayName && onboardingData.display_name.trim()) {
          const { error: updateError } = await supabase.auth.updateUser({
            data: { full_name: onboardingData.display_name }
          });
          
          if (updateError) {
            console.error('Error updating user display name:', updateError);
            // Don't fail the onboarding if display name update fails
          }
        }

        setOnboardingId(data.id);
        
        // Set data for prompts step
        setOnboardingDataForPrompts({
          companyName: onboardingData.company_name,
          industry: onboardingData.industry
        });

        // Move to prompts step
        setOnboardingStep(prev => prev + 1);
        return;
      } catch (error) {
        console.error('Error saving onboarding data:', error);
        toast.error('Failed to save onboarding data. Please try again.');
        return;
      }
    }

    // Handle prompts step completion
    if (onboardingStep === 2) {
      // Start monitoring
      try {
        await confirmAndStartMonitoring();
        // The usePromptsLogic hook will handle the rest
        return;
      } catch (error) {
        console.error('Error starting monitoring:', error);
        toast.error('Failed to start monitoring. Please try again.');
        return;
      }
    }
  };

  // Navigate to dashboard when prompts are completed
  useEffect(() => {
    if (progress.completed === progress.total && progress.total > 0) {
      // Add a small delay to ensure the loading modal shows completion
      setTimeout(async () => {
        try {
          // Verify the update completed
          const { data, error } = await supabase
            .from('user_onboarding')
            .select('prompts_completed')
            .eq('id', onboardingId)
            .single();
          
          // If the column doesn't exist yet, we'll consider it complete
          // as long as we have the onboarding record
          if (error && !error.message?.includes('column "prompts_completed" does not exist')) {
            console.error('Error verifying completion:', error);
            toast.error('Failed to complete setup. Please try again.');
            return;
          }

          // Navigate if either prompts_completed is true or the column doesn't exist yet
          if (!error || error.message?.includes('column "prompts_completed" does not exist')) {
            onOpenChange(false);
            navigate('/dashboard', { 
              state: { 
                shouldRefresh: true,
                onboardingData: {
                  displayName: onboardingData.display_name,
                  companyName: onboardingData.company_name,
                  industry: onboardingData.industry,
                  id: onboardingId
                }
              },
              replace: true
            });
          }
        } catch (error) {
          console.error('Error navigating after completion:', error);
          toast.error('Setup completed but navigation failed. Please refresh the page.');
        }
      }, 1000);
    }
  }, [progress.completed, progress.total, onboardingId, onboardingData, onOpenChange, navigate]);

  const handleBack = () => {
    setOnboardingStep(prev => prev - 1);
  };

  const currentStep = onboardingSteps[onboardingStep];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`${currentStep.isPromptsStep ? 'max-w-5xl max-h-[90vh] overflow-y-auto' : 'sm:max-w-[500px]'} bg-[#fbeef3]`}>
          {!currentStep.isWelcomeStep && (
            <>
              <DialogTitle className="text-xl font-semibold text-[hsl(221,56%,22%)]">
                {currentStep.title}
              </DialogTitle>
              <DialogDescription className="text-[hsl(221,56%,22%)]">
                {currentStep.description}
              </DialogDescription>
            </>
          )}

          <div className="space-y-4">
            {currentStep.isWelcomeStep ? (
              <div className="text-center space-y-4 py-6">
                <div className="w-16 h-16 mx-auto flex items-center justify-center">
                  <img src="/logos/PinkBadge.png" alt="PerceptionX Logo" className="w-16 h-16 rounded-full" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-medium text-[hsl(221,56%,22%)]">Welcome to the Beta!</h3>
                  <p className="text-sm text-[hsl(221,56%,22%)]">
                    You're among the first to experience PerceptionX. We're excited to have you on board and can't wait to see how you'll use our platform to understand and improve your company's employer perception.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {currentStep.fields.map((field, index) => (
                  <div key={index}>
                    <Label htmlFor={field.label.toLowerCase().replace(/\s+/g, '-')} className="text-[hsl(221,56%,22%)]">
                      {field.label}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        id={field.label.toLowerCase().replace(/\s+/g, '-')}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        placeholder={field.placeholder}
                        className="mt-1 text-[#13274F]"
                      />
                    ) : (
                      <Input
                        id={field.label.toLowerCase().replace(/\s+/g, '-')}
                        type={field.type}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        placeholder={field.placeholder}
                        className="mt-1 text-[#13274F]"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Prompts step content */}
            {currentStep.isPromptsStep && localPrompts && (
              <div className="space-y-6">
                <PromptsTable 
                  prompts={localPrompts.filter(p => p.type !== 'talentx') as any} 
                  companyName={onboardingData.company_name} 
                />
                <div className="flex justify-between items-center">
                  <Button
                    onClick={handleBack}
                    variant="outline"
                    className="text-gray-600"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <div className="flex gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowHowItWorks(true)}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    >
                      How does this work?
                    </Button>
                    <ConfirmationCard 
                      isConfirming={isConfirming}
                      onConfirm={confirmAndStartMonitoring}
                      disabled={!onboardingRecord}
                      className="w-auto"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              {onboardingStep > 0 && !currentStep.isPromptsStep && (
                <Button
                  onClick={handleBack}
                  variant="outline"
                  className="text-gray-600"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              {!currentStep.isPromptsStep && (
                <>
                  {onboardingStep === 0 ? (
                    <Button
                      onClick={handleNext}
                      variant="default"
                      className="w-full"
                    >
                      Get Started
                    </Button>
                  ) : (
                    <Button
                      onClick={handleNext}
                      variant="default"
                      className="w-full ml-4"
                    >
                      Next
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Loading Modal for prompts processing */}
      <LoadingModal
        isOpen={isConfirming}
        currentModel={progress.currentModel}
        currentPrompt={progress.currentPrompt}
        completed={progress.completed}
        total={progress.total}
        showResultsButton={true}
        onClose={() => setIsConfirming(false)}
        isLoadingComplete={progress.completed === progress.total && progress.total > 0}
      />

      {/* How it works Modal */}
      <Dialog open={showHowItWorks} onOpenChange={setShowHowItWorks}>
        <DialogContent className="max-w-2xl bg-[#fbeef3]">
          <DialogTitle className="text-xl font-semibold text-[hsl(221,56%,22%)]">
            How it works
          </DialogTitle>
          <DialogDescription className="text-[hsl(221,56%,22%)] opacity-70">
            Understanding the different types of prompts and their purpose
          </DialogDescription>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
            <div className="text-center space-y-3">
              <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium mx-auto w-fit">
                Sentiment
              </div>
              <p className="text-sm text-[hsl(221,56%,22%)]">
                Brand-specific prompts that measure general sentiment about your culture, with balanced perspectives.
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium mx-auto w-fit">
                Visibility
              </div>
              <p className="text-sm text-[hsl(221,56%,22%)]">
                Industry-wide prompts that track how often your company is mentioned compared to competitors.
              </p>
            </div>
            <div className="text-center space-y-3">
              <div className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium mx-auto w-fit">
                Competitive
              </div>
              <p className="text-sm text-[hsl(221,56%,22%)]">
                Direct comparison prompts that analyze your employer reputation relative to specific competitors.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}; 