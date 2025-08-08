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

  // Check if user needs to provide display name
  useEffect(() => {
    if (user && open) {
      setNeedsDisplayName(!user.user_metadata?.full_name && !user.user_metadata?.name);
      // Pre-fill display name if available
      const existingName = user.user_metadata?.full_name || user.user_metadata?.name || "";
      setOnboardingData(prev => ({ ...prev, display_name: existingName }));
    }
  }, [user, open]);

  const onboardingSteps = [
    {
      title: "Let's get you set up!",
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
          placeholder: "e.g., Tech, Finance, Healthcare",
          value: onboardingData.industry,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, industry: value }))
        }
      ]
    }
  ];

  const handleNext = async () => {
    // Validate required fields
    const requiredFields = needsDisplayName 
      ? [onboardingData.display_name, onboardingData.company_name, onboardingData.industry]
      : [onboardingData.company_name, onboardingData.industry];
    
    if (requiredFields.some(field => !field.trim())) {
      toast.error('Please fill in all required fields before continuing');
      return;
    }

    if (onboardingStep === onboardingSteps.length - 1) {
      // Save onboarding data
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
        onOpenChange(false);

        // Check for existing prompts
        const { data: existingPrompts, error: fetchError } = await supabase
          .from('confirmed_prompts')
          .select('prompt_text')
          .eq('onboarding_id', data.id);

        if (fetchError) {
          console.error('Error fetching existing prompts:', fetchError);
          throw fetchError;
        }

        // Generate prompts only if none exist
        if (!existingPrompts || existingPrompts.length === 0) {
          const prompts = [
            {
              onboarding_id: data.id,
              user_id: user?.id,
              prompt_text: `How is ${data.company_name} as an employer?`,
              prompt_category: 'Employer Reputation',
              prompt_type: 'sentiment' as 'sentiment',
              is_active: true
            },
            {
              onboarding_id: data.id,
              user_id: user?.id,
              prompt_text: `How does working at ${data.company_name} compare to other companies in the ${data.industry} industry?`,
              prompt_category: 'Competitive Analysis',
              prompt_type: 'competitive' as 'competitive',
              is_active: true
            },
            {
              onboarding_id: data.id,
              user_id: user?.id,
              prompt_text: `What is the best company to work for in the ${data.industry} industry?`,
              prompt_category: 'Industry Leaders',
              prompt_type: 'visibility' as 'visibility',
              is_active: true
            }
          ];

          const { error: promptsError } = await supabase
            .from('confirmed_prompts')
            .insert(prompts);

          if (promptsError) {
            console.error('Error inserting prompts:', promptsError);
            toast.error('Failed to generate prompts. Please try again.');
            return;
          }
        } else {
          // Prompts already exist for this onboarding record
        }

        // Navigate to dashboard and trigger prompts modal, including onboarding record ID
        navigate('/dashboard', {
          state: {
            onboardingData: {
              displayName: onboardingData.display_name,
              companyName: data.company_name,
              industry: data.industry,
              id: data.id
            },
            userId: user?.id,
            showPromptsModal: true
          },
          replace: true
        });
      } catch (error) {
        console.error('Error saving onboarding data:', error);
        toast.error('Failed to save onboarding data. Please try again.');
      }
    } else {
      setOnboardingStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setOnboardingStep(prev => prev - 1);
  };

  const currentStep = onboardingSteps[onboardingStep];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogTitle className="text-xl font-semibold text-gray-900">
          {currentStep.title}
        </DialogTitle>
        <DialogDescription className="text-gray-600">
          {currentStep.description}
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-4">
            {currentStep.fields.map((field, index) => (
              <div key={index}>
                <Label htmlFor={field.label.toLowerCase().replace(/\s+/g, '-')} className="text-[#13274F]">
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

          <div className="flex justify-between">
            {onboardingStep > 0 && (
              <Button
                onClick={handleBack}
                variant="outline"
                className="text-gray-600"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            {onboardingStep === 0 ? (
              <Button
                onClick={handleNext}
                variant="default"
                className="w-full"
              >
                Next
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 