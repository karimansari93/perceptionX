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
import UserMenu from "@/components/UserMenu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface OnboardingData {
  companyName: string;
  industry: string;
  hiringChallenges?: string[];
  targetRoles?: string[];
  currentStrategy?: string;
  talentCompetitors?: string[];
}

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    companyName: "",
    industry: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingId, setOnboardingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [tempInput, setTempInput] = useState("");

  const onboardingSteps = [
    {
      title: "Company Information",
      description: "Let's start with some basic information about your company.",
      fields: [
        {
          label: "Company Name",
          type: "text",
          placeholder: "Enter your company name",
          value: onboardingData.companyName,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, companyName: value }))
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

  // Load existing onboarding data and resume from correct step
  useEffect(() => {
    const loadOnboardingProgress = async () => {
      setIsLoading(true);
      setConnectionError(false);
      
      try {
        // Test connection first
        const { error: connectionTest } = await supabase
          .from('user_onboarding')
          .select('id')
          .limit(1);

        if (connectionTest) {
          console.error('Connection test failed:', connectionTest);
          setConnectionError(true);
          setIsLoading(false);
          return;
        }

        // Try to find existing onboarding record for this user
        let onboardingRecord = null;
        
        if (user) {
          console.log('Loading onboarding progress for user:', user.id);
          const { data: userRecord, error: userError } = await supabase
            .from('user_onboarding')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (userError) {
            console.error('Error loading user onboarding:', userError);
          } else if (userRecord && userRecord.length > 0) {
            onboardingRecord = userRecord[0];
          }
        }

        if (onboardingRecord) {
          setOnboardingId(onboardingRecord.id);
          const data = {
            companyName: onboardingRecord.company_name || "",
            industry: onboardingRecord.industry || "",
          };
          setOnboardingData(data);
          setOnboardingStep(0); // Always 0 for single-step onboarding
        }
      } catch (error) {
        console.error('Error loading onboarding progress:', error);
        setConnectionError(true);
        toast.error('Failed to load onboarding progress');
      } finally {
        setIsLoading(false);
      }
    };

    loadOnboardingProgress();
  }, [user]);

  const saveOnboardingProgress = async (data: OnboardingData, step: number) => {
    if (!user) return;

    try {
      const onboardingRecord = {
        user_id: user.id,
        company_name: data.companyName,
        industry: data.industry,
        current_step: step,
        session_id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      if (onboardingId) {
        const { error } = await supabase
          .from('user_onboarding')
          .update(onboardingRecord)
          .eq('id', onboardingId);

        if (error) throw error;
      } else {
        const { data: newRecord, error } = await supabase
          .from('user_onboarding')
          .insert([onboardingRecord])
          .select();

        if (error) throw error;
        if (newRecord) setOnboardingId(newRecord[0].id);
      }
    } catch (error) {
      console.error('Error saving onboarding progress:', error);
      setConnectionError(true);
      toast.error('Failed to save progress');
    }
  };

  const handleNext = async () => {
    const currentStep = onboardingSteps[onboardingStep];
    const isValid = currentStep.fields.every(field => field.value.trim());

    if (!isValid) {
      toast.error("Please fill in all required fields");
      return;
    }

    await saveOnboardingProgress(onboardingData, 1);
    navigate('/auth', { 
      state: { 
        onboardingData,
        redirectTo: '/dashboard'
      } 
    });
  };

  const handleBack = () => {
    setOnboardingStep(prev => prev - 1);
  };

  const handleComplete = async () => {
    await saveOnboardingProgress(onboardingData, onboardingSteps.length);
    navigate('/auth', { 
      state: { 
        onboardingData,
        redirectTo: '/dashboard'
      } 
    });
  };

  const progress = 100; // Only one step, always 100%
  const isComplete = false; // Never show the complete state

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Loading your onboarding progress...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
      <div className="container mx-auto px-6 py-8">
        <div className="max-w-3xl mx-auto">
          {connectionError && (
            <Card className="mb-6 bg-yellow-50 border-yellow-200">
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 text-yellow-800">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">Connection Issue</span>
                </div>
                <p className="text-yellow-700 mt-1">
                  Unable to save progress to database. You can continue with onboarding, but your progress won't be saved until the connection is restored.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="bg-white shadow-lg">
            <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center">
                  <div className="w-6 h-6 mr-2 rounded-full overflow-hidden flex-shrink-0">
                    <img 
                      src="/lovable-uploads/4e28aa28-e0f0-4c44-ba78-9965207a284e.png" 
                      alt="PerceptionX Logo" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  PerceptionX Setup
                </CardTitle>
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary">Step 1 of 1</Badge>
                </div>
              </div>
              <Progress value={progress} className="mt-4" />
            </CardHeader>
            <CardContent className="p-6">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  {onboardingSteps[onboardingStep].title}
                </h2>
                <p className="text-gray-600">
                  {onboardingSteps[onboardingStep].description}
                </p>
              </div>

              <div className="space-y-6">
                {onboardingSteps[onboardingStep].fields.map((field, index) => (
                  <div key={index} className="space-y-2">
                    <Label htmlFor={field.label}>{field.label}</Label>
                    {field.type === "textarea" ? (
                      <Textarea
                        id={field.label}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="min-h-[100px]"
                      />
                    ) : (
                      <Input
                        id={field.label}
                        type={field.type}
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end mt-8">
                <Button
                  onClick={handleNext}
                  style={{ backgroundColor: '#db5f89' }}
                  className="hover:opacity-90 text-white"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
