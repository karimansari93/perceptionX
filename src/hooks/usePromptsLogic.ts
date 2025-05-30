import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

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
  console.log('usePromptsLogic onboardingData:', onboardingData);
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
      console.log('No onboardingData, cannot generate prompts');
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
    console.log('Generated prompts:', generatedPrompts);
    setPrompts(generatedPrompts);
  };

  const confirmAndStartMonitoring = async () => {
    console.log('Confirm clicked');
    if (!user || !onboardingRecord) {
      console.error('Missing user or onboardingRecord', { user, onboardingRecord });
      toast.error('Missing user or onboarding data. Please try again.');
      return;
    }
    setIsConfirming(true);
    try {
      console.log('=== STARTING MONITORING PROCESS ===');
      console.log('Using onboarding record:', onboardingRecord.id);
      console.log('Company:', onboardingRecord.company_name);

      const promptsToInsert = prompts.map(prompt => ({
        onboarding_id: onboardingRecord.id,
        user_id: user.id,
        prompt_text: prompt.text,
        prompt_category: prompt.category,
        prompt_type: prompt.type,
        is_active: true
      }));
      console.log('Prompts to insert:', promptsToInsert);
      const { data: confirmedPrompts, error: insertError } = await supabase
        .from('confirmed_prompts')
        .insert(promptsToInsert)
        .select();
      if (insertError) {
        console.error('Failed to insert prompts:', insertError);
        throw insertError;
      }
      console.log('Confirmed prompts inserted:', confirmedPrompts?.length);

      // Calculate total operations for progress tracking
      const totalOperations = (confirmedPrompts?.length || 0) * 3; // 3 models per prompt
      setProgress({ completed: 0, total: totalOperations });

      let completedOperations = 0;

      // Test each prompt with all models
      for (const confirmedPrompt of confirmedPrompts || []) {
        console.log('=== TESTING PROMPT ===');
        console.log('Prompt:', confirmedPrompt.prompt_text);
        console.log('Type:', confirmedPrompt.prompt_type);
        
        // Test with OpenAI
        setProgress(prev => ({ 
          ...prev, 
          currentModel: 'OpenAI GPT-4o-mini',
          currentPrompt: confirmedPrompt.prompt_text
        }));
        await testWithModel(confirmedPrompt, 'test-prompt-openai', 'gpt-4o-mini');
        completedOperations++;
        setProgress(prev => ({ ...prev, completed: completedOperations }));
        
        // Test with Claude
        setProgress(prev => ({ 
          ...prev, 
          currentModel: 'Claude 3 Sonnet',
          currentPrompt: confirmedPrompt.prompt_text
        }));
        await testWithModel(confirmedPrompt, 'test-prompt-claude', 'claude-3-sonnet');
        completedOperations++;
        setProgress(prev => ({ ...prev, completed: completedOperations }));
        
        // Test with Perplexity
        setProgress(prev => ({ 
          ...prev, 
          currentModel: 'Perplexity Llama 3.1',
          currentPrompt: confirmedPrompt.prompt_text
        }));
        await testWithModel(confirmedPrompt, 'test-prompt-perplexity', 'llama-3.1-sonar-small-128k-online');
        completedOperations++;
        setProgress(prev => ({ ...prev, completed: completedOperations }));
      }

      console.log('All prompts tested, navigating to dashboard...');
      toast.success('Prompts confirmed and monitoring started!');
      
      // Wait a moment for the user to see completion, then navigate to dashboard
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 1500);

    } catch (error) {
      console.error('Error confirming prompts:', error);
      toast.error('Failed to confirm prompts. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      console.log(`=== CALLING ${functionName.toUpperCase()} ===`);
      console.log('Prompt:', confirmedPrompt.prompt_text);
      
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
      } else if (responseData?.response) {
        console.log(`${functionName} response received, analyzing...`);
        
        // Handle citations from Perplexity responses
        const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
        
        console.log('=== CALLING ANALYZE-RESPONSE ===');
        console.log('Company Name:', onboardingData?.companyName);
        console.log('Prompt Type:', confirmedPrompt.prompt_type);
        
        // Analyze sentiment and extract citations with enhanced visibility support
        const { data: sentimentData, error: sentimentError } = await supabase.functions
          .invoke('analyze-response', {
            body: { 
              response: responseData.response,
              companyName: onboardingData?.companyName,
              promptType: confirmedPrompt.prompt_type,
              perplexityCitations: perplexityCitations
            }
          });

        if (sentimentError) {
          console.error('Sentiment analysis error:', sentimentError);
        }

        console.log('=== ANALYSIS COMPLETE ===');
        console.log('Sentiment data:', sentimentData);

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
          console.error(`Error storing ${functionName} response:`, storeError);
        } else {
          console.log(`${functionName} response stored successfully`);
          console.log('Stored data - Company mentioned:', sentimentData?.company_mentioned);
          console.log('Stored data - Mention ranking:', sentimentData?.mention_ranking);
          console.log('Stored data - Competitor mentions:', sentimentData?.competitor_mentions?.length);
        }
      }
    } catch (error) {
      console.error(`Error testing with ${functionName}:`, error);
    }
  };

  return {
    prompts,
    isConfirming,
    onboardingRecord,
    error,
    progress,
    confirmAndStartMonitoring
  };
};

// New utility function to generate and insert prompts
export const generateAndInsertPrompts = async (user: any, onboardingRecord: any, onboardingData: OnboardingData, setProgress: (progress: ProgressInfo) => void) => {
  if (!user || !onboardingRecord) {
    throw new Error('Missing user or onboarding data');
  }
  
  console.log('=== STARTING MONITORING PROCESS ===');
  console.log('Using onboarding record:', onboardingRecord.id);
  console.log('Company:', onboardingRecord.company_name);

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

  console.log('Confirmed prompts inserted:', confirmedPrompts?.length);

  // Calculate total operations for progress tracking
  const totalOperations = (confirmedPrompts?.length || 0) * 3; // 3 models per prompt
  setProgress({ completed: 0, total: totalOperations });

  let completedOperations = 0;

  // Define testWithModel inside this function to avoid scope issues
  const testWithModel = async (confirmedPrompt: any, functionName: string, modelName: string) => {
    try {
      console.log(`=== CALLING ${functionName.toUpperCase()} ===`);
      console.log('Prompt:', confirmedPrompt.prompt_text);
      
      const { data: responseData, error: functionError } = await supabase.functions
        .invoke(functionName, {
          body: { prompt: confirmedPrompt.prompt_text }
        });

      if (functionError) {
        console.error(`${functionName} edge function error:`, functionError);
      } else if (responseData?.response) {
        console.log(`${functionName} response received, analyzing...`);
        
        // Handle citations from Perplexity responses
        const perplexityCitations = functionName === 'test-prompt-perplexity' ? responseData.citations : null;
        
        console.log('=== CALLING ANALYZE-RESPONSE ===');
        console.log('Company Name:', onboardingData?.companyName);
        console.log('Prompt Type:', confirmedPrompt.prompt_type);
        
        // Analyze sentiment and extract citations with enhanced visibility support
        const { data: sentimentData, error: sentimentError } = await supabase.functions
          .invoke('analyze-response', {
            body: { 
              response: responseData.response,
              companyName: onboardingData?.companyName,
              promptType: confirmedPrompt.prompt_type,
              perplexityCitations: perplexityCitations
            }
          });

        if (sentimentError) {
          console.error('Sentiment analysis error:', sentimentError);
        }

        console.log('=== ANALYSIS COMPLETE ===');
        console.log('Sentiment data:', sentimentData);

        // Combine Perplexity citations with analyzed citations
        let finalCitations = sentimentData?.citations || [];
        if (perplexityCitations && perplexityCitations.length > 0) {
          finalCitations = [...perplexityCitations, ...finalCitations];
        }
      }
    } catch (error) {
      console.error(`Error testing with ${modelName}:`, error);
    }
  };

  // Test each prompt with all models
  for (const confirmedPrompt of confirmedPrompts || []) {
    console.log('=== TESTING PROMPT ===');
    console.log('Prompt:', confirmedPrompt.prompt_text);
    console.log('Type:', confirmedPrompt.prompt_type);
    
    // Test with OpenAI
    setProgress({ 
      currentModel: 'OpenAI GPT-4o-mini',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-openai', 'gpt-4o-mini');
    completedOperations++;
    setProgress({ 
      currentModel: 'OpenAI GPT-4o-mini',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    
    // Test with Claude
    setProgress({ 
      currentModel: 'Claude 3 Sonnet',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-claude', 'claude-3-sonnet');
    completedOperations++;
    setProgress({ 
      currentModel: 'Claude 3 Sonnet',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    
    // Test with Perplexity
    setProgress({ 
      currentModel: 'Perplexity Llama 3.1',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
    await testWithModel(confirmedPrompt, 'test-prompt-perplexity', 'llama-3.1-sonar-small-128k-online');
    completedOperations++;
    setProgress({ 
      currentModel: 'Perplexity Llama 3.1',
      currentPrompt: confirmedPrompt.prompt_text,
      completed: completedOperations,
      total: totalOperations
    });
  }

  console.log('All prompts tested.');
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
