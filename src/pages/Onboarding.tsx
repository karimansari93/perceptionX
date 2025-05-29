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
  hiringChallenges: string[];
  targetRoles: string[];
  currentStrategy: string;
  talentCompetitors: string[];
}

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    companyName: "",
    industry: "",
    hiringChallenges: ["", "", ""],
    targetRoles: ["", "", ""],
    currentStrategy: "",
    talentCompetitors: ["", "", ""]
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
          placeholder: "e.g., Oil & Gas, Tech, Finance, Healthcare",
          value: onboardingData.industry,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, industry: value }))
        }
      ]
    },
    {
      title: "What are your main hiring challenges?",
      description: "List three main hiring challenges (one per field).",
      fields: [
        {
          label: "Hiring Challenge #1",
          type: "text",
          placeholder: "e.g., Attracting tech talent",
          value: onboardingData.hiringChallenges[0],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.hiringChallenges];
            arr[0] = value;
            return { ...prev, hiringChallenges: arr };
          })
        },
        {
          label: "Hiring Challenge #2",
          type: "text",
          placeholder: "e.g., Diversity hiring",
          value: onboardingData.hiringChallenges[1],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.hiringChallenges];
            arr[1] = value;
            return { ...prev, hiringChallenges: arr };
          })
        },
        {
          label: "Hiring Challenge #3",
          type: "text",
          placeholder: "e.g., Employer branding",
          value: onboardingData.hiringChallenges[2],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.hiringChallenges];
            arr[2] = value;
            return { ...prev, hiringChallenges: arr };
          })
        }
      ]
    },
    {
      title: "What roles are you hiring for?",
      description: "List three primary roles you are recruiting for (one per field).",
      fields: [
        {
          label: "Target Role #1",
          type: "text",
          placeholder: "e.g., Software Engineer",
          value: onboardingData.targetRoles[0],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.targetRoles];
            arr[0] = value;
            return { ...prev, targetRoles: arr };
          })
        },
        {
          label: "Target Role #2",
          type: "text",
          placeholder: "e.g., Data Analyst",
          value: onboardingData.targetRoles[1],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.targetRoles];
            arr[1] = value;
            return { ...prev, targetRoles: arr };
          })
        },
        {
          label: "Target Role #3",
          type: "text",
          placeholder: "e.g., Product Manager",
          value: onboardingData.targetRoles[2],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.targetRoles];
            arr[2] = value;
            return { ...prev, targetRoles: arr };
          })
        }
      ]
    },
    {
      title: "Who are your talent competitors?",
      description: "List three main competitors for talent (one per field).",
      fields: [
        {
          label: "Competitor #1",
          type: "text",
          placeholder: "e.g., Google",
          value: onboardingData.talentCompetitors[0],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.talentCompetitors];
            arr[0] = value;
            return { ...prev, talentCompetitors: arr };
          })
        },
        {
          label: "Competitor #2",
          type: "text",
          placeholder: "e.g., Amazon",
          value: onboardingData.talentCompetitors[1],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.talentCompetitors];
            arr[1] = value;
            return { ...prev, talentCompetitors: arr };
          })
        },
        {
          label: "Competitor #3",
          type: "text",
          placeholder: "e.g., Facebook",
          value: onboardingData.talentCompetitors[2],
          onChange: (value: string) => setOnboardingData(prev => {
            const arr = [...prev.talentCompetitors];
            arr[2] = value;
            return { ...prev, talentCompetitors: arr };
          })
        }
      ]
    },
    {
      title: "What are your goals?",
      description: "Tell us about your goals so we can generate prompts that are highly personalized to your needs.",
      fields: [
        {
          label: "Goals",
          type: "textarea",
          placeholder: "Briefly describe your main recruitment goals or what you're trying to improve",
          value: onboardingData.currentStrategy,
          onChange: (value: string) => setOnboardingData(prev => ({ ...prev, currentStrategy: value }))
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
            console.log('Found existing user onboarding record:', onboardingRecord);
          }
        }

        if (onboardingRecord) {
          // Resume from existing data
          setOnboardingId(onboardingRecord.id);
          const data = {
            companyName: onboardingRecord.company_name || "",
            industry: onboardingRecord.industry || "",
            hiringChallenges: onboardingRecord.hiring_challenges || [],
            targetRoles: onboardingRecord.target_roles || [],
            currentStrategy: onboardingRecord.current_strategy || "",
            talentCompetitors: onboardingRecord.talent_competitors || []
          };
          setOnboardingData(data);

          // Determine what step we should be on based on completed data
          let stepToResume = 0;
          if (data.companyName && data.industry) stepToResume = 1;
          if (data.hiringChallenges.length > 0) stepToResume = 2;
          if (data.targetRoles.length > 0) stepToResume = 3;
          if (data.talentCompetitors.length > 0) stepToResume = 4;
          if (data.currentStrategy) stepToResume = 5;

          setOnboardingStep(stepToResume);
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
        hiring_challenges: data.hiringChallenges,
        target_roles: data.targetRoles,
        current_strategy: data.currentStrategy,
        talent_competitors: data.talentCompetitors,
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
    const isValid = currentStep.fields.every(field => {
      if (Array.isArray(field)) return field.every(f => f.value.trim());
      if (field.type === "textarea") return field.value.trim();
      return field.value.trim();
    }) && (
      // For steps with 3 required fields, ensure all are filled
      (onboardingStep !== 1 || onboardingData.hiringChallenges.every(v => v.trim())) &&
      (onboardingStep !== 2 || onboardingData.targetRoles.every(v => v.trim())) &&
      (onboardingStep !== 3 || onboardingData.talentCompetitors.every(v => v.trim()))
    );

    if (!isValid) {
      toast.error("Please fill in all required fields");
      return;
    }

    await saveOnboardingProgress(onboardingData, onboardingStep + 1);
    setOnboardingStep(prev => prev + 1);
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

  const progress = Math.min((onboardingStep / onboardingSteps.length) * 100, 100);
  const isComplete = onboardingStep >= onboardingSteps.length;

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
                  <Badge variant="secondary">Step {onboardingStep + 1} of {onboardingSteps.length}</Badge>
                </div>
              </div>
              <Progress value={progress} className="mt-4" />
            </CardHeader>
            
            <CardContent className="p-6">
              {!isComplete ? (
                <>
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

                  <div className="flex justify-between mt-8">
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      disabled={onboardingStep === 0}
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      onClick={handleNext}
                      style={{ backgroundColor: '#db5f89' }}
                      className="hover:opacity-90 text-white"
                    >
                      {onboardingStep === onboardingSteps.length - 1 ? 'Complete' : 'Next'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="flex items-center justify-center space-x-2 text-green-600 mb-4">
                    <CheckCircle className="w-8 h-8" />
                    <span className="text-xl font-medium">Setup Complete!</span>
                  </div>
                  <p className="text-gray-600 mb-8">
                    Your information has been saved. We'll now analyze your data to generate personalized prompts for your recruitment strategy.
                  </p>
                  <Button
                    onClick={handleComplete}
                    size="lg"
                    style={{ backgroundColor: '#db5f89' }}
                    className="hover:opacity-90 text-white"
                  >
                    Create an Account
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
