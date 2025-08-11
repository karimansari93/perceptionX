import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LLMLogo from "@/components/LLMLogo";

interface LocationState {
  onboardingId: string;
  companyName: string;
  industry: string;
}

// Define the LLM models that will be tested
const llmModels = [
  { name: "OpenAI", model: "openai" },
  { name: "Perplexity", model: "perplexity" },
  { name: "Google AI", model: "google-ai-overviews" }
];

export const OnboardingLoading = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { onboardingId, companyName, industry } = location.state as LocationState;
  
  const [progress, setProgress] = useState({
    currentModel: '',
    currentPrompt: '',
    completed: 0,
    total: 0
  });
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // Auto-rotate carousel every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % llmModels.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!onboardingId) {
      navigate('/onboarding');
      return;
    }

    // Start the actual AI testing process
    const startAITesting = async () => {
      try {
        // Check if prompts already exist for this onboarding session
        const { data: existingPrompts, error: checkError } = await supabase
          .from('confirmed_prompts')
          .select('id, prompt_text, prompt_type')
          .eq('onboarding_id', onboardingId);

        if (checkError) {
          console.error('Error checking existing prompts:', checkError);
          throw new Error(`Failed to check existing prompts: ${checkError.message}`);
        }

        let confirmedPrompts = existingPrompts;

        // Only create prompts if they don't exist
        if (!existingPrompts || existingPrompts.length === 0) {
          // First, generate and insert prompts
          const promptsToInsert = [
            {
              onboarding_id: onboardingId,
              user_id: (await supabase.auth.getUser()).data.user?.id,
              prompt_text: `How is ${companyName} as an employer?`,
              prompt_category: 'Employer Reputation',
              prompt_type: 'sentiment',
              is_active: true
            },
            {
              onboarding_id: onboardingId,
              user_id: (await supabase.auth.getUser()).data.user?.id,
              prompt_text: `What is the best company to work for in the ${industry} industry?`,
              prompt_category: 'Industry Visibility',
              prompt_type: 'visibility',
              is_active: true
            },
            {
              onboarding_id: onboardingId,
              user_id: (await supabase.auth.getUser()).data.user?.id,
              prompt_text: `How does working at ${companyName} compare to other companies in the ${industry} industry?`,
              prompt_category: 'Competitive Analysis',
              prompt_type: 'competitive',
              is_active: true
            }
          ];

          // Insert prompts into confirmed_prompts table
          const { data: newPrompts, error: promptsError } = await supabase
            .from('confirmed_prompts')
            .insert(promptsToInsert)
            .select();

          if (promptsError) {
            throw new Error(`Failed to create prompts: ${promptsError.message}`);
          }

          confirmedPrompts = newPrompts;
        } else {
          // Use existing prompts if available
          if (existingPrompts && existingPrompts.length > 0) {
            confirmedPrompts = existingPrompts;
          }
        }

        // Define models to test
        const modelsToTest = [
          { name: 'openai', displayName: 'OpenAI', functionName: 'test-prompt-openai' },
          { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
          { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' }
        ];

        const totalOperations = confirmedPrompts.length * modelsToTest.length;
        setProgress(prev => ({ ...prev, total: totalOperations }));

        let completedOperations = 0;

        // Check if prompt_responses table exists
        try {
          const { error: tableError } = await supabase
            .from('prompt_responses')
            .select('id')
            .limit(1);
          
          if (tableError && tableError.code === '42P01') {
            // Table doesn't exist yet, skip duplicate checks
          } else if (tableError) {
            // Other error, assume table doesn't exist
          }
        } catch (error) {
          // Error checking table, assume it doesn't exist
        }

        // Test each prompt with each model
        for (const confirmedPrompt of confirmedPrompts) {
          for (const model of modelsToTest) {
            try {
              // Check if response already exists
              try {
                const { data: existingResponse, error: responseCheckError } = await supabase
                  .from('prompt_responses')
                  .select('id')
                  .eq('confirmed_prompt_id', confirmedPrompt.id)
                  .eq('ai_model', model.name)
                  .single();

                if (responseCheckError && responseCheckError.code !== 'PGRST116') {
                  // Error checking existing response, continue with processing
                  continue;
                }

                if (existingResponse) {
                  // Response already exists, skip
                  continue;
                }
              } catch (error) {
                // Error checking existing response, continue with processing
                continue;
              }

              setProgress(prev => ({
                ...prev,
                currentModel: model.displayName,
                currentPrompt: confirmedPrompt.prompt_text
              }));

              // Call the LLM edge function
              const { data: responseData, error: functionError } = await supabase.functions
                .invoke(model.functionName, {
                  body: { prompt: confirmedPrompt.prompt_text }
                });

              if (functionError) {
                console.error(`${model.functionName} error:`, functionError);
                // Continue with next model instead of failing completely
                continue;
              }

              if (responseData && responseData.response) {
                // Process the response
                try {
                  const { data: analysisData, error: analysisError } = await supabase.functions
                    .invoke('analyze-response', {
                      body: {
                        confirmed_prompt_id: confirmedPrompt.id,
                        ai_model: model.name,
                        response: responseData.response,
                        companyName: companyName
                      }
                    });

                  if (analysisError) {
                    console.error(`Error in analyze-response for ${model.name}:`, analysisError);
                    continue;
                  }

                  if (analysisData) {
                    // Successfully processed response
                    continue;
                  }
                } catch (error) {
                  // Exception in analyze-response, continue with next model
                  continue;
                }
              }

              completedOperations++;
              setProgress(prev => ({ ...prev, completed: completedOperations }));

              // Small delay to show progress
              await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (modelError) {
              console.error(`Error with ${model.name}:`, modelError);
              // Continue with next model
              continue;
            }
          }
        }

        // Mark onboarding as complete
        await supabase
          .from('user_onboarding')
          .update({ prompts_completed: true })
          .eq('id', onboardingId);

        // Verify that we have stored responses
        try {
          const { data: storedResponses, error: verifyError } = await supabase
            .from('prompt_responses')
            .select('*')
            .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
            .eq('onboarding_id', onboardingId);

          if (verifyError) {
            console.error('Error checking stored data:', verifyError);
            return;
          }

          if (storedResponses && storedResponses.length > 0) {
            // Successfully stored responses
            return;
          }
        } catch (error) {
          // Exception checking stored data
          return;
        }

        setIsComplete(true);

      } catch (error) {
        console.error('Error in AI testing:', error);
        setError(error.message || 'Failed to complete AI testing');
      }
    };

    startAITesting();
  }, [onboardingId, navigate, companyName, industry]);

  const handleSeeResults = () => {
    navigate('/dashboard', { 
      state: { 
        shouldRefresh: true,
        onboardingData: {
          companyName,
          industry,
          id: onboardingId
        }
      }
    });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
          <div className="text-red-500 mb-4">
            <Loader2 className="w-16 h-16 mx-auto animate-spin" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Testing Failed</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Button onClick={() => navigate('/onboarding')} variant="default">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbeef3] flex items-center justify-center p-4 relative">
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
            <span className="text-sm font-bold text-[hsl(221,56%,22%)]">4</span>
            <span className="text-xs text-[hsl(221,56%,22%)] opacity-70">of 4</span>
          </div>
          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-pink to-pink-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>
      
      {/* Mobile progress indicator - shown below the header row on mobile */}
      <div className="absolute top-20 left-4 right-4 z-10 md:hidden">
        <div className="flex items-center gap-3 bg-white/80 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm border border-white/20 w-full">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-medium text-[hsl(221,56%,22%)] opacity-70">Step</span>
            <span className="text-sm font-bold text-[hsl(221,56%,22%)]">4</span>
            <span className="text-xs text-[hsl(221,56%,22%)] opacity-70">of 4</span>
          </div>
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-pink to-pink-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: '100%' }}
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
      
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full mt-20 md:mt-0">
        <div className="text-center space-y-6">
          {!isComplete ? (
            <>
              <div className="w-20 h-20 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              </div>
              <div className="space-y-3">
                <h1 className="text-2xl font-semibold text-gray-900">Collecting your data</h1>
                <p className="text-gray-600">
                  We're testing how different AI models respond to questions about {companyName} as an employer.
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Progress</span>
                    <span>{progress.completed} of {progress.total}</span>
                  </div>
                  <Progress value={(progress.completed / Math.max(progress.total, 1)) * 100} className="h-2" />
                </div>
                
                {progress.currentPrompt && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-3">
                      Currently: <span className="font-medium">{progress.currentPrompt}</span>
                    </p>
                    
                    {/* LLM Favicon Carousel */}
                    <div className="flex justify-center space-x-4">
                      {llmModels.map((model, index) => (
                        <div key={model.model} className="flex flex-col items-center space-y-1">
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                            carouselIndex === index ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                          }`}>
                            <LLMLogo modelName={model.model} size="sm" className="w-4 h-4" />
                          </div>
                          <div className={`w-2 h-2 rounded-full ${
                            carouselIndex === index ? 'bg-blue-500' : 'bg-gray-300'
                          }`}></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
              <div className="space-y-3">
                <h1 className="text-2xl font-semibold text-gray-900">Your data is ready!</h1>
                <p className="text-gray-600">
                  We've analyzed how AI models perceive {companyName} as an employer. Your results are ready!
                </p>
              </div>
              
              <Button 
                onClick={handleSeeResults}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
              >
                See My Results
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
