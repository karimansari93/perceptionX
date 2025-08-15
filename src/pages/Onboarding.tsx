import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from '@/integrations/supabase/types';
import { PromptsTable } from "@/components/prompts/PromptsTable";
import { ConfirmationCard } from "@/components/prompts/ConfirmationCard";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

// Define the actual database schema we're working with
interface UserOnboarding {
  user_id: string;
  company_name: string;
  industry: string;
  session_id: string;
  company_size?: string;
  role?: string;
  goals?: string[];
  competitors?: string[];
}

interface OnboardingData {
  display_name: string;
  company_name: string;
  industry: string;
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

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [onboardingStep, setOnboardingStep] = useState(0);
  // Total number of steps in the onboarding flow (including the final step on the loading/confirmation page)
  const TOTAL_STEPS = 4;
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    display_name: "",
    company_name: "",
    industry: ""
  });
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
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

  // Check if user needs to provide display name
  useEffect(() => {
    if (user) {
      setNeedsDisplayName(!user.user_metadata?.full_name && !user.user_metadata?.name);
      // Pre-fill display name if available
      const existingName = user.user_metadata?.full_name || user.user_metadata?.name || "";
      setOnboardingData(prev => ({ ...prev, display_name: existingName }));
    }
  }, [user]);

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
          category: 'Industry Visibility',
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
          placeholder: "Enter the company you work for",
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
      title: "Monitoring strategy",
      description: "We'll test how AI models respond to three key questions.",
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

      // Only create new onboarding record if we don't have one
      if (!onboardingId) {
        try {
          // Check if user already has an onboarding record
          const { data: existingOnboarding, error: checkError } = await supabase
            .from('user_onboarding')
            .select('id, company_name, industry')
            .eq('user_id', user?.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (checkError && checkError.code !== 'PGRST116') {
            console.error('Error checking existing onboarding:', checkError);
            throw new Error('Failed to check existing onboarding data');
          }

          if (existingOnboarding) {
            // Use existing onboarding record
            setOnboardingId(existingOnboarding.id);
          } else {
            // Create new onboarding record
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

            setOnboardingId(data.id);
          }
        } catch (error) {
          console.error('Error saving onboarding data:', error);
          toast.error('Failed to save onboarding data. Please try again.');
          return;
        }
      }

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
      
      // Set data for prompts step
      setOnboardingDataForPrompts({
        companyName: onboardingData.company_name,
        industry: onboardingData.industry
      });

      // Move to prompts step
      setOnboardingStep(prev => prev + 1);
      return;
    }

    // Handle prompts step completion
    if (onboardingStep === 2) {
      // Navigate to loading page
      navigate('/onboarding/loading', { 
        state: { 
          onboardingId: onboardingId,
          companyName: onboardingData.company_name,
          industry: onboardingData.industry
        }
      });
      return;
    }
  };

  const handleBack = () => {
    setOnboardingStep(prev => prev - 1);
  };

  // Handle keyboard events
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      // Don't trigger on Enter if user is typing in a textarea
      if (event.target instanceof HTMLTextAreaElement) {
        return;
      }
      handleNext();
    }
  };

  const currentStep = onboardingSteps[onboardingStep];

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#fbeef3] flex items-center justify-center p-4 relative" onKeyPress={handleKeyPress}>
        {/* Hide Crisp button on mobile */}
        <style>{`
          @media (max-width: 768px) {
            #crisp-chatbox {
              display: none !important;
            }
          }
        `}</style>
        {/* Top left logo */}
        <div className="absolute top-6 left-6 z-10">
          <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
            <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
          </a>
        </div>
        
        {/* Top center progress indicator - hidden on mobile, shown below on mobile */}
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-10 hidden md:block">
          <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm border border-white/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[hsl(221,56%,22%)] opacity-70">Step</span>
              <span className="text-sm font-bold text-[hsl(221,56%,22%)]">{onboardingStep + 1}</span>
              <span className="text-xs text-[hsl(221,56%,22%)] opacity-70">of {TOTAL_STEPS}</span>
            </div>
            <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-pink to-pink-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${((onboardingStep + 1) / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        </div>
        
        {/* Mobile progress indicator - shown below the header row on mobile */}
        <div className="absolute top-20 left-4 right-4 z-10 md:hidden">
          <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm border border-white/20 w-full">
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs font-medium text-[hsl(221,56%,22%)] opacity-70">Step</span>
              <span className="text-sm font-bold text-[hsl(221,56%,22%)]">{onboardingStep + 1}</span>
              <span className="text-xs text-[hsl(221,56%,22%)] opacity-70">of {TOTAL_STEPS}</span>
            </div>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-pink to-pink-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${((onboardingStep + 1) / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        </div>
        
        {/* Top right demo link */}
        <div className="absolute top-6 z-10 right-6 md:right-6 left-1/2 md:left-auto transform md:transform-none -translate-x-1/2 md:translate-x-0">
          <div className="flex items-center gap-2 text-sm text-[hsl(221,56%,22%)] font-medium text-center whitespace-nowrap" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <span>Looking to learn more?</span>
            <a 
              href="https://meetings-eu1.hubspot.com/karim-al-ansari" 
              target="_blank" 
              rel="noopener noreferrer"
              className="border-2 border-pink text-pink bg-transparent px-3 py-1 rounded-full hover:bg-pink hover:text-white transition-colors font-bold text-xs"
            >
              Book a demo
            </a>
          </div>
        </div>
        
        <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6 md:p-8 max-w-2xl w-full mt-16 md:mt-0">
          <div className="space-y-4">
            {/* Step title and description (except for welcome step) */}
            {!currentStep.isWelcomeStep && (
              <>
                <div className="mb-2">
                  <h1 className="text-xl sm:text-2xl font-semibold text-[hsl(221,56%,22%)]">
                    {currentStep.title}
                  </h1>
                </div>
                <p className="text-sm sm:text-base text-[hsl(221,56%,22%)] mb-4 sm:mb-6">
                  {currentStep.description}
                </p>
              </>
            )}

            {/* Welcome step content */}
            {currentStep.isWelcomeStep ? (
              <div className="text-center space-y-4 sm:space-y-6">
                <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto">
                  <img 
                    src="/logos/PinkBadge.png" 
                    alt="PerceptionX Logo" 
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
                <div className="space-y-2 sm:space-y-3">
                  <h1 className="text-2xl sm:text-3xl font-bold text-[hsl(221,56%,22%)]">
                    Welcome to the PerceptionX Beta! 🎉
                  </h1>
                  <p className="text-base sm:text-lg text-[hsl(221,56%,22%)]">
                    You're joining an exclusive group of early users helping us shape the future of employer perception analysis. Let's get you started!
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {currentStep.fields.map((field, index) => (
                  <div key={index} className="space-y-2">
                    <Label className="text-[hsl(221,56%,22%)]">
                      {field.label}
                      {field.label === "Industry" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="ml-1 inline-block h-4 w-4 text-gray-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-sm text-gray-700">
                                We need to know the talent industry you compete in to see how visible you are in candidate searches. This can be updated later.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="min-h-[100px]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleNext();
                          }
                        }}
                      />
                    ) : (
                      <Input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleNext();
                          }
                        }}
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
                    ← Back
                  </Button>
                                    <div className="flex gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowHowItWorks(true)}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 hidden md:block"
                    >
                      How does this work?
                    </Button>
                    
                    <ConfirmationCard 
                      isConfirming={false}
                      onConfirm={() => {
                        // Navigate to loading page instead of starting monitoring
                        navigate('/onboarding/loading', { 
                          state: { 
                            onboardingId: onboardingId,
                            companyName: onboardingData.company_name,
                            industry: onboardingData.industry
                          }
                        });
                      }}
                      disabled={false}
                      className="w-auto"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Navigation buttons for non-prompts steps */}
            {!currentStep.isPromptsStep && (
              <div className={`flex ${onboardingStep === 0 ? 'justify-center' : 'justify-between'}`}>
                {onboardingStep > 0 && (
                  <Button
                    onClick={handleBack}
                    variant="outline"
                    className="text-gray-600"
                  >
                    ← Back
                  </Button>
                )}
                <Button
                  onClick={handleNext}
                  variant="default"
                  className={`${onboardingStep === 0 ? 'w-full' : 'ml-auto'}`}
                >
                  {onboardingStep === 0 ? 'Get Started' : 'Next'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* How it works Modal */}
        <Dialog open={showHowItWorks} onOpenChange={setShowHowItWorks}>
          <DialogContent className="max-w-3xl bg-gray-100 sm:top-[50%] sm:translate-y-[-50%] top-auto bottom-0 translate-y-0 rounded-t-xl sm:rounded-lg max-h-[85vh] overflow-y-auto pb-8">
            <DialogTitle className="text-xl font-semibold text-[hsl(221,56%,22%)] mb-6">
              How it works
            </DialogTitle>
            
            {/* Process Description */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-[#0DBCBA] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">1</span>
                </div>
                <h3 className="text-lg font-semibold text-[hsl(221,56%,22%)]">AI Analysis Process</h3>
              </div>
              <p className="text-[hsl(221,56%,22%)] leading-relaxed text-base pl-11">
                We ask multiple AI models the same questions covering the following types of prompts. You get a free sample to see how it works.
              </p>
            </div>
            
            {/* Prompt Types */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-[#0DBCBA] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">2</span>
                </div>
                <h3 className="text-lg font-semibold text-[hsl(221,56%,22%)]">Prompt Categories</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center space-y-2 sm:space-y-3">
                  <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs sm:text-sm font-medium mx-auto w-fit">
                    Sentiment
                  </div>
                  <p className="text-xs sm:text-sm text-[hsl(221,56%,22%)]">
                    Prompts that measure general sentiment about your culture, with balanced perspectives.
                  </p>
                </div>
                <div className="text-center space-y-2 sm:space-y-3">
                  <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs sm:text-sm font-medium mx-auto w-fit">
                    Visibility
                  </div>
                  <p className="text-sm text-[hsl(221,56%,22%)]">
                    Prompts that track how often your company is mentioned compared to competitors.
                  </p>
                </div>
                <div className="text-center space-y-2 sm:space-y-3">
                  <div className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs sm:text-sm font-medium mx-auto w-fit">
                    Competitive
                  </div>
                  <p className="text-sm text-[hsl(221,56%,22%)]">
                    Pompts that analyze your employer reputation relative to specific competitors.
                  </p>
                </div>
              </div>
            </div>

            {/* Pro Features */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-[#0DBCBA] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">3</span>
                </div>
                <h3 className="text-lg font-semibold text-[hsl(221,56%,22%)]">Pro Features</h3>
              </div>
              <div className="pl-11">
                <p className="text-[hsl(221,56%,22%)] leading-relaxed text-base mb-3">
                  <span className="font-semibold text-[#0DBCBA]">Upgrading to Pro</span> unlocks:
                </p>
                <ul className="space-y-2 text-sm text-[hsl(221,56%,22%)]">
                  <li className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#0DBCBA] rounded-full"></div>
                    Weekly updates
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#0DBCBA] rounded-full"></div>
                    Deeper competitive analysis
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#0DBCBA] rounded-full"></div>
                    Source analysis & more features coming soon
                  </li>
                </ul>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};
