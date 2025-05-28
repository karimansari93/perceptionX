import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface OnboardingData {
  companyName: string;
  industry: string;
  hiringChallenges: string[];
  targetRoles: string[];
  currentStrategy: string;
  talentCompetitors: string[];
}

const Analysis = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  const onboardingData = location.state?.onboardingData as OnboardingData;

  const analysisSteps = [
    "Initializing AI network...",
    "Analyzing company perception across LLMs...",
    "Cross-referencing competitor data...",
    "Generating tailored prompts...",
    "Optimizing for your industry...",
    "Finalizing recommendations..."
  ];

  useEffect(() => {
    if (!onboardingData) {
      navigate('/onboarding');
      return;
    }

    // Store onboarding data in database - only if user is authenticated
    const storeOnboardingData = async () => {
      if (!user) return;
      
      try {
        await supabase.from('user_onboarding').insert({
          user_id: user.id,
          session_id: Date.now().toString(), // Generate a session ID for compatibility
          company_name: onboardingData.companyName,
          industry: onboardingData.industry,
          hiring_challenges: onboardingData.hiringChallenges,
          target_roles: onboardingData.targetRoles,
          talent_competitors: onboardingData.talentCompetitors,
          current_strategy: onboardingData.currentStrategy
        });
      } catch (error) {
        console.error('Error storing onboarding data:', error);
      }
    };

    // Only store data if user is authenticated
    if (user) {
      storeOnboardingData();
    }

    // Animate through steps
    const interval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev + 2;
        const newStep = Math.floor(newProgress / 17);
        setCurrentStep(Math.min(newStep, analysisSteps.length - 1));
        
        if (newProgress >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            // If user is not authenticated, redirect to auth with onboarding data
            if (!user) {
              navigate('/auth', { 
                state: { 
                  onboardingData: onboardingData,
                  redirectTo: '/prompts'
                } 
              });
            } else {
              navigate('/prompts', { 
                state: { 
                  onboardingData: onboardingData,
                  userId: user.id
                } 
              });
            }
          }, 1000);
        }
        return Math.min(newProgress, 100);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [onboardingData, navigate, user]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
      <Card className="w-full max-w-4xl mx-6 bg-white shadow-2xl">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Analyzing Your AI Perception
            </h1>
            <p className="text-gray-600">
              Our AI network is processing your data across multiple language models...
            </p>
          </div>

          {/* Network Visualization */}
          <div className="relative h-80 mb-8 overflow-hidden rounded-lg bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
            <svg className="w-full h-full" viewBox="0 0 800 300">
              {/* Connection Lines */}
              <g className="opacity-60">
                <line x1="150" y1="150" x2="400" y2="80" stroke="#60A5FA" strokeWidth="2" className="animate-pulse">
                  <animate attributeName="stroke-dasharray" values="0,20;20,0;0,20" dur="2s" repeatCount="indefinite" />
                </line>
                <line x1="150" y1="150" x2="400" y2="220" stroke="#A78BFA" strokeWidth="2" className="animate-pulse">
                  <animate attributeName="stroke-dasharray" values="0,20;20,0;0,20" dur="2.5s" repeatCount="indefinite" />
                </line>
                <line x1="400" y1="80" x2="650" y2="150" stroke="#34D399" strokeWidth="2" className="animate-pulse">
                  <animate attributeName="stroke-dasharray" values="0,20;20,0;0,20" dur="3s" repeatCount="indefinite" />
                </line>
                <line x1="400" y1="220" x2="650" y2="150" stroke="#F87171" strokeWidth="2" className="animate-pulse">
                  <animate attributeName="stroke-dasharray" values="0,20;20,0;0,20" dur="2.8s" repeatCount="indefinite" />
                </line>
              </g>

              {/* Data Particles */}
              <g>
                <circle r="3" fill="#60A5FA">
                  <animateMotion dur="3s" repeatCount="indefinite">
                    <path d="M150,150 Q275,115 400,80" />
                  </animateMotion>
                </circle>
                <circle r="3" fill="#A78BFA">
                  <animateMotion dur="3.5s" repeatCount="indefinite">
                    <path d="M150,150 Q275,185 400,220" />
                  </animateMotion>
                </circle>
                <circle r="3" fill="#34D399">
                  <animateMotion dur="4s" repeatCount="indefinite">
                    <path d="M400,80 Q525,115 650,150" />
                  </animateMotion>
                </circle>
              </g>

              {/* AI Nodes */}
              <g>
                {/* Central Hub */}
                <circle cx="150" cy="150" r="20" fill="#1E40AF" className="animate-pulse">
                  <animate attributeName="r" values="20;25;20" dur="2s" repeatCount="indefinite" />
                </circle>
                <text x="150" y="190" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">
                  HUB
                </text>

                {/* GPT-4 Node */}
                <circle cx="400" cy="80" r="18" fill="#10B981" className="animate-pulse">
                  <animate attributeName="r" values="18;22;18" dur="2.2s" repeatCount="indefinite" />
                </circle>
                <text x="400" y="55" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">
                  GPT-4
                </text>

                {/* Claude Node */}
                <circle cx="400" cy="220" r="18" fill="#8B5CF6" className="animate-pulse">
                  <animate attributeName="r" values="18;22;18" dur="2.8s" repeatCount="indefinite" />
                </circle>
                <text x="400" y="245" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">
                  Claude
                </text>

                {/* Analysis Node */}
                <circle cx="650" cy="150" r="20" fill="#EF4444" className="animate-pulse">
                  <animate attributeName="r" values="20;25;20" dur="3s" repeatCount="indefinite" />
                </circle>
                <text x="650" y="190" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">
                  Analysis
                </text>
              </g>
            </svg>
          </div>

          {/* Progress Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {analysisSteps[currentStep]}
              </span>
              <span className="text-sm text-gray-500">{progress}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>

          {/* Company Info Display */}
          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Processing Data For:</h3>
            <div className="text-sm text-blue-800">
              <p><strong>Company:</strong> {onboardingData?.companyName}</p>
              <p><strong>Industry:</strong> {onboardingData?.industry}</p>
              <p><strong>Target Roles:</strong> {onboardingData?.targetRoles?.join(', ')}</p>
            </div>
          </div>

          {/* Auth notification if user is not authenticated */}
          {!user && (
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800 text-sm text-center">
                <strong>Almost done!</strong> You'll need to create an account to view and save your personalized prompts.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Analysis;
