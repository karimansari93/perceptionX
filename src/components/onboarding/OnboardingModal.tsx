import { useState } from "react";
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

interface OnboardingData {
  company_name: string;
  industry: string;
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
    company_name: "",
    industry: "",
  });
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);

  const onboardingSteps = [
    {
      title: "Company Information",
      description: "Let's start with some basic information about your company.",
      fields: [
        {
          label: "Company Name",
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
    if (onboardingStep === onboardingSteps.length - 1) {
      // Save onboarding data
      try {
        const newRecord = {
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
        onOpenChange(false);

        // Generate 3 prompts
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
            prompt_text: `What companies offer the best career opportunities in the ${data.industry} industry?`,
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

        // Navigate to dashboard and trigger prompts modal, including onboarding record ID
        navigate('/dashboard', {
          state: {
            onboardingData: {
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

  const currentStep = onboardingSteps[onboardingStep];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle className="sr-only">Company Onboarding</DialogTitle>
        <DialogDescription className="sr-only">
          Enter your company information to get started with PerceptionX
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
          </div>

          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900">{currentStep.title}</h2>
              <p className="text-gray-600 mt-2">{currentStep.description}</p>
            </div>

            <div className="space-y-4">
              {currentStep.fields.map((field, index) => (
                <div key={index}>
                  <Label htmlFor={field.label.toLowerCase().replace(/\s+/g, '-')}>
                    {field.label}
                  </Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      id={field.label.toLowerCase().replace(/\s+/g, '-')}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      placeholder={field.placeholder}
                      className="mt-1"
                    />
                  ) : (
                    <Input
                      id={field.label.toLowerCase().replace(/\s+/g, '-')}
                      type={field.type}
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      placeholder={field.placeholder}
                      className="mt-1"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleNext}
                className="bg-[#db5f89] hover:bg-[#c94e7c] text-white px-6 py-2 text-base font-semibold rounded-full shadow-none flex items-center"
                style={{ minWidth: 120 }}
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                {onboardingStep === onboardingSteps.length - 1 ? 'Complete' : 'Next'}
              </Button>
            </div>

            <Progress 
              value={(onboardingStep + 1) / onboardingSteps.length * 100} 
              className="mt-4"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 