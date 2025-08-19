import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getLLMDisplayName } from '@/config/llmLogos';
import { TALENTX_ATTRIBUTES, getProOnlyAttributes, getFreeAttributes } from '@/config/talentXAttributes';
import { useSubscription } from '@/hooks/useSubscription';
import { logger, sanitizeInput, safeStorePromptResponse, checkExistingPromptResponse } from '@/lib/utils';

interface OnboardingData {
  companyName: string;
  industry: string;
  country?: string;
  job_function?: string;
}

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'sentiment' | 'visibility' | 'competitive' | 'talentx';
}

export interface ProgressInfo {
  currentModel?: string;
  currentPrompt?: string;
  completed: number;
  total: number;
}

export const usePromptsLogic = (onboardingData?: OnboardingData) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const [prompts, setPrompts] = useState<GeneratedPrompt[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [onboardingRecord, setOnboardingRecord] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo>({
    currentModel: '',
    currentPrompt: '',
    completed: 0,
    total: 0
  });

  useEffect(() => {
    if (onboardingData && (onboardingData as any).id) {
      setOnboardingRecord(onboardingData);
    } else {
      const checkOnboarding = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) {
            setError('Please sign in to continue');
            return;
          }

          const { data, error } = await supabase
            .from('user_onboarding')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (error) throw error;

          if (!data || data.length === 0) {
            setError('Please complete onboarding first');
            return;
          }

          // Check if the onboarding record has the required fields
          const onboardingRecord = data[0];
          if (!onboardingRecord.company_name || !onboardingRecord.industry) {
            setError('Onboarding data is incomplete. Please complete onboarding first.');
            return;
          }

          setOnboardingRecord(onboardingRecord);
        } catch (error) {
          logger.error('Error checking onboarding:', error);
          setError('Failed to check onboarding status');
        }
      };
      checkOnboarding();
    }
  }, [onboardingData]);

  useEffect(() => {
    // Always generate fresh prompts with location support when onboarding data is available
    if (onboardingData) {
      generatePrompts();
    }
  }, [onboardingData]);

  const generatePrompts = () => {
    if (!onboardingData) {
      return;
    }
    const { companyName, industry, country } = onboardingData;
    
    // Determine if we should include location-specific prompts
    const hasLocation = country && country !== 'GLOBAL';
    const formattedCountry = hasLocation ? formatCountryForPrompt(country) : '';
    const locationSuffix = hasLocation ? ` in ${formattedCountry}` : '';
    
    let generatedPrompts: GeneratedPrompt[] = [
      {
        id: 'sentiment-1',
        text: `How is ${companyName} as an employer${hasLocation ? ` in ${formattedCountry}` : ''}?`,
        category: 'Employer Reputation',
        type: 'sentiment'
      },
      {
        id: 'visibility-1',
        text: `What companies offer the best career opportunities in the ${industry} industry${locationSuffix}?`,
        category: 'Industry Leaders',
        type: 'visibility'
      },
      {
        id: 'competitive-1',
        text: `How does working at ${companyName} compare to other companies in the ${industry} industry${locationSuffix}?`,
        category: 'Competitive Analysis',
        type: 'competitive'
      }
    ];
    setPrompts(generatedPrompts);
  };

  const confirmAndStartMonitoring = async () => {
    if (!user || !onboardingRecord) {
      console.error('Missing user or onboardingRecord:', { user, onboardingRecord });
      toast.error('Missing user or onboarding data. Please try again.');
      return;
    }
    
    // Check if onboarding record has required fields
    if (!onboardingRecord.company_name || !onboardingRecord.industry) {
      console.error('Onboarding record missing required fields:', onboardingRecord);
      toast.error('Onboarding data is incomplete. Please complete onboarding first.');
      return;
    }
    
    // Check if prompts are already completed to prevent duplicate processing
    if (onboardingRecord.prompts_completed) {
      console.log('Prompts already completed, navigating to dashboard');
      navigate('/dashboard', { 
        state: { 
          shouldRefresh: true,
          onboardingData: {
            companyName: onboardingRecord.companyName,
            industry: onboardingRecord.industry,
            id: onboardingRecord.id
          }
        },
        replace: true 
      });
      return;
    }
    
    setIsConfirming(true);
    try {
      // Use subscription status from useSubscription hook
      const isProUser = isPro;

      // Use the new generateAndInsertPrompts function
      const onboardingData = {
        companyName: onboardingRecord.companyName,
        industry: onboardingRecord.industry
      };

      const confirmedPrompts = await generateAndInsertPrompts(
        user, 
        onboardingRecord, 
        onboardingData, 
        setProgress,
        isProUser
      );

      // Clear any existing responses for these prompts
      const promptIds = confirmedPrompts.map(p => p.id);
      const { error: deleteError } = await supabase
        .from('prompt_responses')
        .delete()
        .in('confirmed_prompt_id', promptIds);

      if (deleteError) {
        console.error('Error clearing existing responses:', deleteError);
        throw deleteError;
      }

      // Define which models to test based on subscription status
      const modelsToTest = isProUser ? [
        { name: 'openai', displayName: getLLMDisplayName('openai'), functionName: 'test-prompt-openai' },
        { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
        { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' }, // Using Google AI Overviews during onboarding
        { name: 'deepseek', displayName: 'DeepSeek', functionName: 'test-prompt-deepseek' },
        { name: 'google-ai-overviews', displayName: 'Google AI Overviews', functionName: 'test-prompt-google-ai-overviews' }
      ] : [
        { name: 'openai', displayName: getLLMDisplayName('openai'), functionName: 'test-prompt-openai' },
        { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
        { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' } // Using Google AI Overviews during onboarding
      ];

      // Now run the testing/monitoring process for all prompts
      const totalOperations = (confirmedPrompts?.length || 0) * modelsToTest.length;
      setProgress({ completed: 0, total: totalOperations });
      let completedOperations = 0;

      for (const confirmedPrompt of confirmedPrompts || []) {
        try {
          for (const model of modelsToTest) {
            setProgress(prev => ({ 
              ...prev, 
              currentModel: model.displayName,
              currentPrompt: confirmedPrompt.prompt_text
            }));
            
            try {
              await testWithModel(confirmedPrompt, model.functionName, model.name);
              completedOperations++;
              setProgress(prev => ({ ...prev, completed: completedOperations }));
            } catch (modelError) {
              console.error(`Error with ${model.name}:`, modelError);
              
              // Show error toast but continue with other models
              if (modelError.message?.includes('overloaded')) {
                toast.error(`${model.displayName} is currently overloaded. Skipping to next model.`);
              } else if (modelError.message?.includes('quota')) {
                toast.error(`${model.displayName} quota exceeded. Skipping to next model.`);
              } else {
                toast.error(`${model.displayName} failed: ${modelError.message}. Skipping to next model.`);
              }
              
              // Continue with next model instead of failing completely
              continue;
            }
          }
        } catch (error) {
          console.error('Error testing prompt:', error);
          
          // Provide specific error messages for common issues
          if (error.message?.includes('overloaded')) {
            toast.error(`The AI model is currently overloaded. Please try again in a few minutes.`);
          } else if (error.message?.includes('quota')) {
            toast.error(`API quota exceeded. Please try again later.`);
          } else if (error.message?.includes('authentication')) {
            toast.error(`Authentication error. Please contact support.`);
          } else {
            toast.error(`Error testing prompt: ${error.message}`);
          }
          
          // Continue with next prompt instead of failing completely
          continue;
        }
      }

              // Prompts confirmed and monitoring started - no toast needed
      
      // Ensure we're in a valid state before navigating
      if (completedOperations > 0) {
        try {
          // Update the onboarding record to mark prompts as completed
          const { error: updateError } = await supabase
            .from('user_onboarding')
            .update({ prompts_completed: true })
            .eq('id', onboardingRecord.id);

          if (updateError) {
            // If the error is about the column not existing, we can ignore it
            // as the migration will handle it later
            if (!updateError.message?.includes('column "prompts_completed" does not exist')) {
              console.error('Error updating onboarding record:', updateError);
              throw new Error('Failed to update onboarding status');
            }
          }

          setTimeout(() => {
            navigate('/dashboard', { 
              state: { 
                shouldRefresh: true,
                onboardingData: {
                  companyName: onboardingRecord.companyName,
                  industry: onboardingRecord.industry,
                  id: onboardingRecord.id
                }
              },
              replace: true 
            });
          }, 1500);
        } catch (error) {
          console.error('Error in final update:', error);
          // Still navigate even if the update fails
          // The migration will handle setting prompts_completed later
          setTimeout(() => {
            navigate('/dashboard', { 
              state: { 
                shouldRefresh: true,
                onboardingData: {
                  companyName: onboardingRecord.companyName,
                  industry: onboardingRecord.industry,
                  id: onboardingRecord.id
                }
              },
              replace: true 
            });
          }, 1500);
        }
      } else {
        throw new Error('No operations were completed successfully');
      }
    } catch (error) {
      console.error('Error confirming prompts:', error);
      toast.error(error.message || 'Failed to confirm prompts. Please try again.');
      setIsConfirming(false);
    }
  };

  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
        console.error('Error details:', functionError.details);
        console.error('Error context:', functionError.context);
        
        // Handle specific error cases
        if (functionError.message?.includes('overloaded') || functionError.message?.includes('quota')) {
          throw new Error(`The ${modelName} model is currently overloaded. Please try again later.`);
        }
        
        if (functionError.message?.includes('API key') || functionError.message?.includes('unauthorized')) {
          throw new Error(`Authentication error with ${modelName}. Please contact support.`);
        }
        
        if (functionError.message?.includes('invalid')) {
          throw new Error(`Invalid request to ${modelName}. Please check your prompt.`);
        }
        
        // Check if there are additional error details
        if (functionError.details) {
          throw new Error(`API Error: ${functionError.message}. ${functionError.details}`);
        }
        
        throw new Error(`API Error: ${functionError.message}`);
      }

      if (!responseData) {
        throw new Error(`No response data from ${modelName}`);
      }

      if (!responseData.response) {
        throw new Error(`Invalid response format from ${modelName}`);
      }
      
      // Handle citations from Perplexity responses
      const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
      
      // Check if response already exists for this prompt and model
      const responseExists = await checkExistingPromptResponse(
        supabase,
        confirmedPrompt.id,
        modelName
      );

      if (responseExists) {
        return;
      }

      // Analyze sentiment and extract citations with enhanced visibility support
      
      const { data: sentimentData, error: sentimentError } = await supabase.functions
        .invoke('analyze-response', {
          body: { 
            response: responseData.response,
            companyName: onboardingRecord?.company_name || onboardingData?.companyName,
            promptType: confirmedPrompt.prompt_type,
            perplexityCitations: perplexityCitations,
            confirmed_prompt_id: confirmedPrompt.id,
            ai_model: modelName
          }
        });

      if (sentimentError) {
        throw new Error(`Sentiment Analysis Error: ${sentimentError.message}`);
      }

      if (!sentimentData) {
        throw new Error('No sentiment analysis data received');
      }
    } catch (error) {
      // Provide user-friendly error messages
      if (error.message?.includes('overloaded')) {
        throw new Error(`The ${modelName} model is currently experiencing high demand. Please try again in a few minutes.`);
      }
      
      if (error.message?.includes('quota')) {
        throw new Error(`API quota exceeded for ${modelName}. Please try again later.`);
      }
      
      throw error; // Re-throw to be handled by the caller
    }
  };

  return {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring,
    setIsConfirming
  };
};

// New utility function to generate and insert prompts
export const generateAndInsertPrompts = async (user: any, onboardingRecord: any, onboardingData: OnboardingData, setProgress: (progress: ProgressInfo) => void, isProUser: boolean = false) => {
  if (!user || !onboardingRecord) {
    throw new Error('Missing user or onboarding data');
  }

  // Check if prompts already exist for this onboarding record
  const { data: existingPrompts, error: existingError } = await supabase
    .from('confirmed_prompts')
    .select('*')
    .eq('onboarding_id', onboardingRecord.id);

  if (existingError) {
    console.error('Error checking existing prompts:', existingError);
  }

  if (existingPrompts && existingPrompts.length > 0) {
    return existingPrompts;
  }

  // Generate prompts based on onboarding data and subscription status
  const promptsToInsert = generatePromptsFromData(onboardingData, isProUser).map(prompt => ({
    onboarding_id: onboardingRecord.id,
    user_id: user.id,
    prompt_text: prompt.text,
    prompt_category: prompt.category,
    prompt_type: prompt.type,
    talentx_attribute_id: prompt.type === 'talentx' ? prompt.id.replace('talentx-', '') : null,
    is_active: true
  }));

  const { data: confirmedPrompts, error: insertError } = await supabase
    .from('confirmed_prompts')
    .insert(promptsToInsert)
    .select();

  if (insertError) {
    console.error('Failed to insert prompts:', insertError);
    throw insertError;
  }

  // Define which models to test based on subscription status
  const modelsToTest = isProUser ? [
    { name: 'openai', displayName: getLLMDisplayName('openai'), functionName: 'test-prompt-openai' },
    { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
    { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' }, // Using Google AI Overviews during onboarding
    { name: 'deepseek', displayName: 'DeepSeek', functionName: 'test-prompt-deepseek' },
    { name: 'google-ai-overviews', displayName: 'Google AI Overviews', functionName: 'test-prompt-google-ai-overviews' }
  ] : [
    { name: 'openai', displayName: getLLMDisplayName('openai'), functionName: 'test-prompt-openai' },
    { name: 'perplexity', displayName: 'Perplexity', functionName: 'test-prompt-perplexity' },
    { name: 'google-ai-overviews', displayName: 'Google AI', functionName: 'test-prompt-google-ai-overviews' } // Using Google AI Overviews during onboarding
  ];

  // Calculate total operations for progress tracking
  const totalOperations = (confirmedPrompts?.length || 0) * modelsToTest.length;
  setProgress({ completed: 0, total: totalOperations });

  let completedOperations = 0;

  // Define testWithModel inside this function to avoid scope issues
  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
      } else if (responseData?.response) {
        // Handle citations from Perplexity and Google AI Overviews responses
        const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
        const googleAICitations = functionName === 'test-prompt-google-ai-overviews' ? responseData.citations : null;
        
        // Analyze sentiment and extract citations with enhanced visibility support
        const { data: sentimentData, error: sentimentError } = await supabase.functions
          .invoke('analyze-response', {
            body: { 
              response: responseData.response,
              companyName: onboardingRecord?.company_name || onboardingData.companyName,
              promptType: confirmedPrompt.prompt_type,
              perplexityCitations: perplexityCitations,
              citations: googleAICitations, // Pass Google AI citations separately
              confirmed_prompt_id: confirmedPrompt.id,
              ai_model: modelName
            }
          });

        if (sentimentError) {
          throw new Error(`Sentiment analysis error: ${sentimentError.message}`);
        }

        // Combine Perplexity citations with analyzed citations
        let finalCitations = sentimentData?.citations || [];
        if (perplexityCitations && perplexityCitations.length > 0) {
          finalCitations = [...perplexityCitations, ...finalCitations];
        }

        // Store the response with enhanced analysis
        const { error: storeError } = await supabase
          .from('prompt_responses')
          .insert({
            confirmed_prompt_id: confirmedPrompt.id,
            ai_model: modelName,
            response_text: responseData.response,
            sentiment_score: sentimentData?.sentiment_score || 0,
            sentiment_label: sentimentData?.sentiment_label || 'neutral',
            citations: finalCitations,
            company_mentioned: sentimentData?.company_mentioned || false,
            mention_ranking: sentimentData?.mention_ranking || null,
            competitor_mentions: sentimentData?.competitor_mentions || [],
            first_mention_position: sentimentData?.first_mention_position || null,
            total_words: responseData.response.split(' ').length,
            visibility_score: sentimentData?.visibility_score || 0,
            competitive_score: sentimentData?.competitive_score || 0,

          });

        if (storeError) {
          console.error(`Error storing ${modelName} response:`, storeError);
        }
      }
    } catch (error) {
      console.error(`Error testing with ${modelName}:`, error);
    }
  };

  // Test each prompt with allowed models based on subscription
  for (const confirmedPrompt of confirmedPrompts || []) {
    for (const model of modelsToTest) {
      setProgress({ 
        currentModel: model.displayName,
        currentPrompt: confirmedPrompt.prompt_text,
        completed: completedOperations,
        total: totalOperations
      });
      await testWithModel(confirmedPrompt, model.functionName, model.name);
      completedOperations++;
    }
  }

  return confirmedPrompts;
};

// Helper function to format country names properly
const formatCountryForPrompt = (countryCode: string): string => {
  // Countries that need "the" article
  const countriesWithThe = [
    'US', 'AE', 'GB', 'NL', 'PH', 'VA', 'CZ', 'DO', 'GA', 'GM',
    'IO', 'KY', 'MH', 'NP', 'SB', 'TC', 'TF', 'VG', 'VI'
  ];
  
  // Country code to display name mapping
  const countryNames: { [key: string]: string } = {
    'US': 'United States',
    'GB': 'United Kingdom', 
    'AE': 'United Arab Emirates',
    'NL': 'Netherlands',
    'PH': 'Philippines',
    'VA': 'Vatican City',
    'DO': 'Dominican Republic',
    'GA': 'Gambia',
    'GM': 'Gambia',
    'IO': 'British Indian Ocean Territory',
    'KY': 'Cayman Islands',
    'MH': 'Marshall Islands',
    'NP': 'Nepal',
    'SB': 'Solomon Islands',
    'TC': 'Turks and Caicos Islands',
    'TF': 'French Southern Territories',
    'VG': 'British Virgin Islands',
    'VI': 'Virgin Islands',
    // Add more country mappings as needed
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'JP': 'Japan',
    'BR': 'Brazil',
    'IN': 'India',
    'CN': 'China',
    'MX': 'Mexico',
    'RU': 'Russia',
    'KR': 'South Korea',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'BE': 'Belgium',
    'IE': 'Ireland',
    'PT': 'Portugal',
    'GR': 'Greece',
    'PL': 'Poland',
    'HU': 'Hungary',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'HR': 'Croatia',
    'BG': 'Bulgaria',
    'RO': 'Romania',
    'EE': 'Estonia',
    'LV': 'Latvia',
    'LT': 'Lithuania'
  };
  
  const countryName = countryNames[countryCode] || countryCode;
  const needsThe = countriesWithThe.includes(countryCode);
  
  return needsThe ? `the ${countryName}` : countryName;
};

// Helper function to generate prompts from onboarding data
const generatePromptsFromData = (onboardingData: OnboardingData, isProUser: boolean = false): GeneratedPrompt[] => {
  const { companyName, industry, country } = onboardingData;
  
  // Determine if we should include location-specific prompts
  const hasLocation = country && country !== 'GLOBAL';
  const formattedCountry = hasLocation ? formatCountryForPrompt(country) : '';
  const locationSuffix = hasLocation ? ` in ${formattedCountry}` : '';
  
  const basePrompts: GeneratedPrompt[] = [
    {
      id: 'sentiment-1',
      text: `How is ${companyName} as an employer${hasLocation ? ` in ${formattedCountry}` : ''}?`,
      category: 'Employer Reputation',
      type: 'sentiment'
    },
    {
      id: 'visibility-1',
      text: `What companies offer the best career opportunities in the ${industry} industry${locationSuffix}?`,
      category: 'Industry Leaders',
      type: 'visibility'
    },
    {
      id: 'competitive-1',
      text: `How does working at ${companyName} compare to other companies in the ${industry} industry${locationSuffix}?`,
      category: 'Competitive Analysis',
      type: 'competitive'
    }
  ];

  // Only add TalentX prompts for Pro users
  if (isProUser) {
    const talentXPrompts: GeneratedPrompt[] = [];
    
    // Include free attributes for Pro users
    const freeAttributes = getFreeAttributes();
    freeAttributes.forEach(attr => {
      talentXPrompts.push({
        id: `talentx-${attr.id}`,
        text: attr.promptTemplate.replace('{companyName}', companyName),
        category: `TalentX: ${attr.category}`,
        type: 'talentx' as const
      });
    });

    // Add pro-only attributes
    const proAttributes = getProOnlyAttributes();
    proAttributes.forEach(attr => {
      talentXPrompts.push({
        id: `talentx-${attr.id}`,
        text: attr.promptTemplate.replace('{companyName}', companyName),
        category: `TalentX: ${attr.category}`,
        type: 'talentx' as const
      });
    });

    return [...basePrompts, ...talentXPrompts];
  }

  // For free users, only return the base prompts
  return basePrompts;
};
