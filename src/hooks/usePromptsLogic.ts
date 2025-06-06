import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getLLMDisplayName } from '@/config/llmLogos';

interface OnboardingData {
  companyName: string;
  industry: string;
}

interface GeneratedPrompt {
  id: string;
  text: string;
  category: string;
  type: 'sentiment' | 'visibility' | 'competitive';
}

export interface ProgressInfo {
  currentModel?: string;
  currentPrompt?: string;
  completed: number;
  total: number;
}

export const usePromptsLogic = (onboardingData?: OnboardingData) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('usePromptsLogic initialized');
  }
  const navigate = useNavigate();
  const { user } = useAuth();
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

          setOnboardingRecord(data[0]);
        } catch (error) {
          console.error('Error checking onboarding:', error);
          setError('Failed to check onboarding status');
        }
      };
      checkOnboarding();
    }
  }, [onboardingData]);

  useEffect(() => {
    // Fetch prompts from confirmed_prompts if onboardingData.id is present
    const fetchPrompts = async () => {
      if (onboardingData && (onboardingData as any).id) {
        const { data, error } = await (supabase as any)
          .from('confirmed_prompts')
          .select('*')
          .eq('onboarding_id', (onboardingData as any).id);
        if (error) {
          console.error('Error fetching prompts:', error);
          return;
        }
        if (data && data.length > 0) {
          setPrompts(
            data.map((p: any) => ({
              id: p.id,
              text: p.prompt_text,
              category: p.prompt_category,
              type: p.prompt_type
            }))
          );
        }
      }
    };
    fetchPrompts();
  }, [onboardingData]);

  const generatePrompts = () => {
    if (!onboardingData) {
      if (process.env.NODE_ENV === 'development') {
        console.log('No onboardingData, cannot generate prompts');
      }
      return;
    }
    const { companyName, industry } = onboardingData;
    let generatedPrompts: GeneratedPrompt[] = [
      {
        id: 'sentiment-1',
        text: `How is ${companyName} as an employer?`,
        category: 'Employer Reputation',
        type: 'sentiment'
      },
      {
        id: 'visibility-1',
        text: `What companies offer the best career opportunities in the ${industry} industry?`,
        category: 'Industry Leaders',
        type: 'visibility'
      },
      {
        id: 'competitive-1',
        text: `How does working at ${companyName} compare to other companies in the ${industry} industry?`,
        category: 'Competitive Analysis',
        type: 'competitive'
      }
    ];
    if (process.env.NODE_ENV === 'development') {
      console.log('Generated prompts:', generatedPrompts.length);
    }
    setPrompts(generatedPrompts);
  };

  const confirmAndStartMonitoring = async () => {
    if (!user || !onboardingRecord) {
      console.error('Missing user or onboardingRecord:', { user, onboardingRecord });
      toast.error('Missing user or onboarding data. Please try again.');
      return;
    }
    setIsConfirming(true);
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('Starting monitoring process with:', { 
          userId: user.id, 
          onboardingId: onboardingRecord.id 
        });
      }

      // First, deactivate any existing prompts for this user
      const { error: deactivateError } = await supabase
        .from('confirmed_prompts')
        .update({ is_active: false })
        .eq('user_id', user.id);

      if (deactivateError) {
        console.error('Error deactivating existing prompts:', deactivateError);
        throw deactivateError;
      }

      // Fetch all prompts for this onboarding record
      let { data: allPrompts, error: fetchAllError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('onboarding_id', onboardingRecord.id)
        .eq('user_id', user.id);

      if (fetchAllError) {
        console.error('Error fetching all prompts:', fetchAllError);
        throw fetchAllError;
      }

      // If no prompts exist, insert the default prompts
      if (!allPrompts || allPrompts.length === 0) {
        console.log('No existing prompts found, inserting default prompts');
        const defaultPrompts = [
          {
            onboarding_id: onboardingRecord.id,
            user_id: user.id,
            prompt_text: `How is ${onboardingRecord.company_name} as an employer?`,
            prompt_category: 'Employer Reputation',
            prompt_type: 'sentiment' as 'sentiment',
            is_active: true
          },
          {
            onboarding_id: onboardingRecord.id,
            user_id: user.id,
            prompt_text: `What companies offer the best career opportunities in the ${onboardingRecord.industry} industry?`,
            prompt_category: 'Industry Leaders',
            prompt_type: 'visibility' as 'visibility',
            is_active: true
          },
          {
            onboarding_id: onboardingRecord.id,
            user_id: user.id,
            prompt_text: `How does working at ${onboardingRecord.company_name} compare to other companies in the ${onboardingRecord.industry} industry?`,
            prompt_category: 'Competitive Analysis',
            prompt_type: 'competitive' as 'competitive',
            is_active: true
          }
        ];

        const { data: insertedPrompts, error: insertError } = await supabase
          .from('confirmed_prompts')
          .insert(defaultPrompts)
          .select();

        if (insertError) {
          console.error('Failed to insert prompts:', insertError);
          throw insertError;
        }

        if (!insertedPrompts || insertedPrompts.length === 0) {
          throw new Error('Failed to insert prompts: No data returned');
        }

        allPrompts = insertedPrompts;
        console.log('Successfully inserted default prompts:', insertedPrompts.length);
      } else {
        // Reactivate the existing prompts
        const { error: activateError } = await supabase
          .from('confirmed_prompts')
          .update({ is_active: true })
          .eq('onboarding_id', onboardingRecord.id)
          .eq('user_id', user.id);

        if (activateError) {
          console.error('Error activating prompts:', activateError);
          throw activateError;
        }
      }

      // Clear any existing responses for these prompts
      const promptIds = allPrompts.map(p => p.id);
      const { error: deleteError } = await supabase
        .from('prompt_responses')
        .delete()
        .in('confirmed_prompt_id', promptIds);

      if (deleteError) {
        console.error('Error clearing existing responses:', deleteError);
        throw deleteError;
      }

      // Now run the testing/monitoring process for all prompts
      const totalOperations = (allPrompts?.length || 0) * 4;
      setProgress({ completed: 0, total: totalOperations });
      let completedOperations = 0;

      for (const confirmedPrompt of allPrompts || []) {
        console.log('=== TESTING PROMPT ===');
        console.log('Prompt:', confirmedPrompt.prompt_text);
        console.log('Type:', confirmedPrompt.prompt_type);

        try {
          // Test with OpenAI
          setProgress(prev => ({ 
            ...prev, 
            currentModel: getLLMDisplayName('openai'),
            currentPrompt: confirmedPrompt.prompt_text
          }));
          await testWithModel(confirmedPrompt, 'test-prompt-openai', 'openai');
          completedOperations++;
          setProgress(prev => ({ ...prev, completed: completedOperations }));

          // Test with Perplexity
          setProgress(prev => ({ 
            ...prev, 
            currentModel: 'Perplexity',
            currentPrompt: confirmedPrompt.prompt_text
          }));
          await testWithModel(confirmedPrompt, 'test-prompt-perplexity', 'perplexity');
          completedOperations++;
          setProgress(prev => ({ ...prev, completed: completedOperations }));

          // Test with Gemini
          setProgress(prev => ({ 
            ...prev, 
            currentModel: 'Gemini',
            currentPrompt: confirmedPrompt.prompt_text
          }));
          await testWithModel(confirmedPrompt, 'test-prompt-gemini', 'gemini');
          completedOperations++;
          setProgress(prev => ({ ...prev, completed: completedOperations }));

          // Test with DeepSeek
          setProgress(prev => ({ 
            ...prev, 
            currentModel: 'DeepSeek',
            currentPrompt: confirmedPrompt.prompt_text
          }));
          await testWithModel(confirmedPrompt, 'test-prompt-deepseek', 'deepseek');
          completedOperations++;
          setProgress(prev => ({ ...prev, completed: completedOperations }));
        } catch (error) {
          console.error('Error testing prompt:', error);
          toast.error(`Error testing prompt: ${error.message}`);
          // Continue with next prompt instead of failing completely
          continue;
        }
      }

      console.log('All prompts tested, navigating to dashboard...');
      toast.success('Prompts confirmed and monitoring started!');
      
      // Ensure we're in a valid state before navigating
      if (completedOperations > 0) {
        setTimeout(() => {
          navigate('/dashboard', { 
            state: { 
              shouldRefresh: true,
              onboardingData: {
                companyName: onboardingRecord.company_name,
                industry: onboardingRecord.industry,
                id: onboardingRecord.id
              }
            },
            replace: true 
          });
        }, 1500);
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
      if (process.env.NODE_ENV === 'development') {
        console.log(`Testing with ${modelName}`);
      }
      
      // Check for existing response first
      const { data: existingResponse } = await supabase
        .from('prompt_responses')
        .select('*')
        .eq('confirmed_prompt_id', confirmedPrompt.id)
        .eq('ai_model', modelName)
        .single();

      if (existingResponse) {
        console.log(`Response already exists for ${modelName}, skipping...`);
        return;
      }
      
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
        throw new Error(`API Error: ${functionError.message}`);
      }

      if (!responseData) {
        throw new Error(`No response data from ${modelName}`);
      }

      if (!responseData.response) {
        throw new Error(`Invalid response format from ${modelName}`);
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(`${modelName} response received`);
      }
      
      // Handle citations from Perplexity responses
      const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
      
      // Analyze sentiment and extract citations with enhanced visibility support
      const { data: sentimentData, error: sentimentError } = await supabase.functions
        .invoke('analyze-response', {
          body: { 
            response: responseData.response,
            companyName: onboardingData?.companyName,
            promptType: confirmedPrompt.prompt_type,
            perplexityCitations: perplexityCitations,
            confirmed_prompt_id: confirmedPrompt.id,
            ai_model: modelName
          }
        });

      if (sentimentError) {
        console.error('Sentiment analysis error:', sentimentError);
        throw new Error(`Sentiment Analysis Error: ${sentimentError.message}`);
      }

      if (!sentimentData) {
        throw new Error('No sentiment analysis data received');
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(`${modelName} response stored successfully`);
      }
    } catch (error) {
      console.error(`Error testing with ${modelName}:`, error);
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
export const generateAndInsertPrompts = async (user: any, onboardingRecord: any, onboardingData: OnboardingData, setProgress: (progress: ProgressInfo) => void) => {
  if (!user || !onboardingRecord) {
    throw new Error('Missing user or onboarding data');
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.log('Starting monitoring process');
  }

  // Generate prompts based on onboarding data
  const promptsToInsert = generatePromptsFromData(onboardingData).map(prompt => ({
    onboarding_id: onboardingRecord.id,
    user_id: user.id,
    prompt_text: prompt.text,
    prompt_category: prompt.category,
    prompt_type: prompt.type,
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

  if (process.env.NODE_ENV === 'development') {
    console.log('Prompts inserted:', confirmedPrompts?.length);
  }

  // Calculate total operations for progress tracking
  const totalOperations = (confirmedPrompts?.length || 0) * 4; // 4 models per prompt
  setProgress({ completed: 0, total: totalOperations });

  let completedOperations = 0;

  // Define testWithModel inside this function to avoid scope issues
  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Testing with ${modelName}`);
      }
      
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
      } else if (responseData?.response) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`${modelName} response received`);
        }
        
        // Handle citations from Perplexity responses
        const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
        
        // Analyze sentiment and extract citations with enhanced visibility support
        const { data: sentimentData, error: sentimentError } = await supabase.functions
          .invoke('analyze-response', {
            body: { 
              response: responseData.response,
              companyName: onboardingData?.companyName,
              promptType: confirmedPrompt.prompt_type,
              perplexityCitations: perplexityCitations,
              confirmed_prompt_id: confirmedPrompt.id,
              ai_model: modelName
            }
          });

        if (sentimentError) {
          console.error('Sentiment analysis error:', sentimentError);
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
            competitor_mentions: sentimentData?.competitor_mentions || []
          });

        if (storeError) {
          console.error(`Error storing ${modelName} response:`, storeError);
        } else if (process.env.NODE_ENV === 'development') {
          console.log(`${modelName} response stored successfully`);
        }
      }
    } catch (error) {
      console.error(`Error testing with ${modelName}:`, error);
    }
  };

  // Test each prompt with all models
  for (const confirmedPrompt of confirmedPrompts || []) {
    if (process.env.NODE_ENV === 'development') {
      console.log('Testing prompt:', confirmedPrompt.prompt_text);
    }
    
    // Test with OpenAI
    setProgress({ 
      currentModel: getLLMDisplayName('openai'),
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-openai', 'openai');
    completedOperations++;
    
    // Test with Perplexity
    setProgress({ 
      currentModel: 'Perplexity',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-perplexity', 'perplexity');
    completedOperations++;
    
    // Test with Gemini
    setProgress({ 
      currentModel: 'Gemini',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-gemini', 'gemini');
    completedOperations++;
    
    // Test with DeepSeek
    setProgress({ 
      currentModel: 'DeepSeek',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-deepseek', 'deepseek');
    completedOperations++;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('All prompts tested');
  }
  return confirmedPrompts;
};

// Helper function to generate prompts from onboarding data
const generatePromptsFromData = (onboardingData: OnboardingData): GeneratedPrompt[] => {
  const { companyName, industry } = onboardingData;
  return [
    {
      id: 'sentiment-1',
      text: `How is ${companyName} as an employer?`,
      category: 'Employer Reputation',
      type: 'sentiment'
    },
    {
      id: 'visibility-1',
      text: `What companies offer the best career opportunities in the ${industry} industry?`,
      category: 'Industry Leaders',
      type: 'visibility'
    },
    {
      id: 'competitive-1',
      text: `How does working at ${companyName} compare to other companies in the ${industry} industry?`,
      category: 'Competitive Analysis',
      type: 'competitive'
    }
  ];
};
