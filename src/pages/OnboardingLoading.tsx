import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LLMLogo from "@/components/LLMLogo";
import { checkExistingPromptResponse, logger } from "@/lib/utils";
import { useDashboardData } from "@/hooks/useDashboardData";

interface LocationState {
  onboardingId: string;
  companyName: string;
  industry: string;
  country: string;
}

// Define the LLM models that will be tested
const llmModels = [
  { name: "ChatGPT", model: "openai" },
  { name: "Perplexity", model: "perplexity" },
  { name: "Google AI", model: "google-ai-overviews" },
  { name: "Bing Copilot", model: "bing-copilot" },
  { name: "Search Insights", model: "search-insights" }
];

// Helper function to format prompts with country context
const getCountryContext = (country: string) => {
  if (!country || country === 'GLOBAL') {
    return '';
  }
  // Map country codes to readable names for better prompt context
  const countryNames: Record<string, string> = {
    'US': ' in the United States',
    'GB': ' in the United Kingdom',
    'CA': ' in Canada',
    'AU': ' in Australia',
    'DE': ' in Germany',
    'FR': ' in France',
    'NL': ' in the Netherlands',
    'SE': ' in Sweden',
    'NO': ' in Norway',
    'DK': ' in Denmark',
    'FI': ' in Finland',
    'CH': ' in Switzerland',
    'AT': ' in Austria',
    'BE': ' in Belgium',
    'IE': ' in Ireland',
    'IT': ' in Italy',
    'ES': ' in Spain',
    'PT': ' in Portugal',
    'PL': ' in Poland',
    'CZ': ' in the Czech Republic',
    'HU': ' in Hungary',
    'SK': ' in Slovakia',
    'SI': ' in Slovenia',
    'HR': ' in Croatia',
    'BG': ' in Bulgaria',
    'RO': ' in Romania',
    'EE': ' in Estonia',
    'LV': ' in Latvia',
    'LT': ' in Lithuania',
    'LU': ' in Luxembourg',
    'MT': ' in Malta',
    'CY': ' in Cyprus',
    'GR': ' in Greece',
    'JP': ' in Japan',
    'KR': ' in South Korea',
    'SG': ' in Singapore',
    'MY': ' in Malaysia',
    'TH': ' in Thailand',
    'PH': ' in the Philippines',
    'ID': ' in Indonesia',
    'IN': ' in India',
    'VN': ' in Vietnam',
    'BR': ' in Brazil',
    'MX': ' in Mexico',
    'AR': ' in Argentina',
    'CL': ' in Chile',
    'CO': ' in Colombia',
    'PE': ' in Peru',
    'ZA': ' in South Africa',
    'AE': ' in the UAE',
    'SA': ' in Saudi Arabia',
    'TR': ' in Turkey',
    'IS': ' in Iceland',
    'NZ': ' in New Zealand'
  };
  return countryNames[country] || ` in ${country}`;
};

export // Helper function to wait for company creation
const waitForCompany = async (onboardingId: string, maxAttempts = 10) => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    
    const { data, error } = await supabase
      .from('user_onboarding')
      .select('company_id')
      .eq('id', onboardingId)
      .single();
    
    if (error) {
      console.error('❌ Error fetching onboarding data:', error);
      throw new Error('Failed to get company information from onboarding record');
    }
    
    if (data?.company_id) {
      return data.company_id;
    }
    
    // Wait with exponential backoff
    const delay = 500 * (attempt + 1);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  throw new Error('Company creation timed out after maximum attempts');
};

const OnboardingLoading = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { onboardingId, companyName, industry, country } = location.state as LocationState;
  
  const [progress, setProgress] = useState({
    currentModel: '',
    currentPrompt: '',
    completed: 0,
    total: 0
  });

  // Optionally load dashboard data if needed in the future
  useDashboardData();
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
        // Get country from database if not provided in state
        let finalCountry = country;
        
        if (!country) {
          const { data: onboardingData, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('country')
            .eq('id', onboardingId)
            .single();
          
          if (!onboardingError && onboardingData) {
            finalCountry = onboardingData.country || 'GLOBAL';
          } else {
            finalCountry = 'GLOBAL';
          }
        }
        
      // Wait for company creation with simple polling
      const companyId = await waitForCompany(onboardingId);

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
          // Generate country context for prompts
          const countryContext = getCountryContext(finalCountry);
          
          // First, generate and insert prompts
          const promptsToInsert = [
            {
              onboarding_id: onboardingId,
              user_id: (await supabase.auth.getUser()).data.user?.id,
              prompt_text: `How is ${companyName} as an employer${countryContext}?`,
              prompt_category: 'General',
              prompt_theme: 'General',
              prompt_type: 'sentiment',
              industry_context: industry,
              is_active: true
            },
            {
              onboarding_id: onboardingId,
              user_id: (await supabase.auth.getUser()).data.user?.id,
              prompt_text: `What is the best company to work for in the ${industry} industry${countryContext}?`,
              prompt_category: 'General',
              prompt_theme: 'General',
              prompt_type: 'visibility',
              industry_context: industry,
              is_active: true
            },
            {
              onboarding_id: onboardingId,
              user_id: (await supabase.auth.getUser()).data.user?.id,
              prompt_text: `How does working at ${companyName} compare to other companies${countryContext}?`,
              prompt_category: 'General',
              prompt_theme: 'General',
              prompt_type: 'competitive',
              industry_context: industry,
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
          // Using existing prompts for onboarding session
        }

        // Define models to test
        const modelsToTest = [
          { name: 'openai', displayName: 'ChatGPT', functionName: 'test-prompt-openai' },
          { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
          { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' }
          // Bing Copilot temporarily disabled - not working
        ];

        const totalOperations = confirmedPrompts.length * modelsToTest.length + 1; // +1 for search insights
        setProgress(prev => ({ ...prev, total: totalOperations }));

        let completedOperations = 0;

        // Check if prompt_responses table exists
        let promptResponsesTableExists = true;
        try {
          const { error: tableCheckError } = await supabase
            .from('prompt_responses')
            .select('id')
            .limit(1);
          
          if (tableCheckError && (tableCheckError.code === '42P01' || tableCheckError.code === '406')) {
            console.log('prompt_responses table does not exist yet, skipping duplicate checks');
            promptResponsesTableExists = false;
          }
        } catch (tableError) {
          console.log('Error checking prompt_responses table, assuming it does not exist:', tableError);
          promptResponsesTableExists = false;
        }

        // Function to run AI prompts
        const runAIPrompts = async () => {
          for (const confirmedPrompt of confirmedPrompts) {
            for (const model of modelsToTest) {
              try {
                // Only check for existing responses if the table exists
                if (promptResponsesTableExists) {
                  // Check if response already exists for this prompt and model
                  const { data: existingResponse, error: responseCheckError } = await supabase
                    .from('prompt_responses')
                    .select('id')
                    .eq('confirmed_prompt_id', confirmedPrompt.id)
                    .eq('ai_model', model.name)
                    .limit(1);

                  if (responseCheckError) {
                    console.error(`Error checking existing response for ${model.name}:`, responseCheckError);
                    // If it's a table not found error or other database error, continue with processing
                    if (responseCheckError.code === '42P01' || responseCheckError.code === '406' || responseCheckError.code === 'PGRST116') {
                      console.log(`Database error for ${model.name} (table may not exist yet), continuing with processing...`);
                    } else {
                      console.log(`Unknown error for ${model.name}, continuing with processing...`);
                    }
                    // Continue with processing regardless of the error
                  }

                  // Skip if response already exists
                  if (existingResponse && existingResponse.length > 0) {
                    console.log(`Response for ${model.name} already exists, skipping...`);
                    completedOperations++;
                    setProgress(prev => ({ ...prev, completed: completedOperations }));
                    continue;
                  }
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
                  // Check if response already exists for this prompt and model
                  const responseExists = await checkExistingPromptResponse(
                    supabase,
                    confirmedPrompt.id,
                    model.name
                  );

                  if (responseExists) {
                    continue;
                  }

                  // Process the response through analyze-response
                  const perplexityCitations = model.functionName === 'test-prompt-perplexity' ? responseData.citations : null;
                  const googleAICitations = model.name === 'google-ai-overviews' ? responseData.citations : null;
                  
                  try {
                    console.log('🔍 Calling analyze-response with:', {
                      companyName,
                      company_id: companyId,
                      confirmed_prompt_id: confirmedPrompt.id,
                      ai_model: model.name
                    });
                    
                    // Safety check: Don't proceed if company_id is still null
                    if (!companyId) {
                      console.error('❌ Skipping analyze-response: company_id is null');
                      logger.error(`Skipping analysis for ${model.name}: company_id is null`);
                      continue; // Skip this response
                    }
                    
                    const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-response', {
                      body: {
                        response: responseData.response,
                        companyName: companyName,
                        promptType: confirmedPrompt.prompt_type,
                        perplexityCitations: perplexityCitations,
                        citations: googleAICitations,
                        confirmed_prompt_id: confirmedPrompt.id,
                        ai_model: model.name,
                        company_id: companyId
                      }
                    });

                    if (analysisError) {
                      logger.error(`Analysis error for ${model.name}:`, analysisError);
                    }
                  } catch (analysisError) {
                    logger.error(`Analysis exception for ${model.name}:`, analysisError);
                  }
                }

                completedOperations++;
                setProgress(prev => ({ ...prev, completed: completedOperations }));

                // Small delay to show progress
                await new Promise(resolve => setTimeout(resolve, 1000));

              } catch (modelError) {
                logger.error(`Error with ${model.name}:`, modelError);
                // Continue with next model
                continue;
              }
            }
          }
        };

        // Function to run search insights
        const runSearchInsights = async () => {
          try {
            
            // Call the search insights function with combined search
            
            // Safety check: Don't proceed if company_id is still null
            if (!companyId) {
              console.error('❌ Skipping search-insights: company_id is null');
              logger.log('Skipping search insights: company_id is null');
              return; // Skip search insights
            }
            
            const { data: searchData, error: searchError } = await supabase.functions.invoke('search-insights', {
              body: {
                companyName: companyName,
                company_id: companyId
              }
            });

            if (searchError) {
              console.error('❌ Search insights error:', searchError);
              logger.log('Search insights failed, but continuing with onboarding');
            } else {
              console.log('✅ Search insights completed successfully');
              logger.log('Search insights data:', searchData);
            }
            
            // Update progress for search insights completion
            completedOperations++;
            setProgress(prev => ({ ...prev, completed: completedOperations }));
            
          } catch (searchException) {
            console.error('Exception during search insights:', searchException);
            logger.log('Search insights exception, but continuing with onboarding');
            
            // Still update progress even if search failed
            completedOperations++;
            setProgress(prev => ({ ...prev, completed: completedOperations }));
          }
        };

        // Run both operations in parallel
        console.log('🚀 Starting parallel AI prompts and search insights...');
        
        // Start search insights immediately
        const searchPromise = runSearchInsights();
        
        // Start AI prompts
        const promptsPromise = runAIPrompts();
        
        // Wait for both to complete
        await Promise.all([promptsPromise, searchPromise]);

        // Mark onboarding as complete (gracefully handle missing field)
        try {
          await supabase
            .from('user_onboarding')
            .update({ prompts_completed: true })
            .eq('id', onboardingId);
        } catch (updateError) {
          console.warn('Could not update prompts_completed field (may not exist in database):', updateError);
          // Continue without failing the onboarding process
        }

        // Verify data was stored by checking the database
        
        try {
          const { data: storedResponses, error: verifyError } = await supabase
            .from('prompt_responses')
            .select('*')
            .eq('confirmed_prompt_id', confirmedPrompts[0].id);

          if (verifyError) {
            console.error('Error checking stored data:', verifyError);
          } else {
            logger.log('Stored responses found:', storedResponses?.length || 0);
          }
        } catch (verifyException) {
          console.error('Exception checking stored data:', verifyException);
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

  // Removed PDF download handler – no longer needed

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
                  We're analyzing how AI models perceive {companyName} as an employer and collecting search insights for a complete picture.
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
                            {model.model === 'search-insights' ? (
                              <Search className="w-4 h-4 text-blue-600" />
                            ) : (
                              <LLMLogo modelName={model.model} size="sm" className="w-4 h-4" />
                            )}
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
                  We've completed a comprehensive analysis of how AI models and search engines perceive {companyName} as an employer. Your results are ready!
                </p>
              </div>
              
              <div className="flex justify-center">
                <Button 
                  onClick={handleSeeResults}
                  size="lg"
                  className="bg-[#ec4899] hover:bg-[#db2777] text-white px-8 border-0"
                  style={{ backgroundColor: '#ec4899' }}
                >
                  See My Results
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingLoading;