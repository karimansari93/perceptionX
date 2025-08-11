import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getLLMDisplayName } from '@/config/llmLogos';
import { useSubscription } from '@/hooks/useSubscription';

interface RefreshProgress {
  currentPrompt: string;
  currentModel: string;
  completed: number;
  total: number;
}

export const useRefreshPrompts = () => {
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);

  const refreshAllPrompts = async (companyName: string, modelType?: string) => {
    if (!user) {
      toast.error('You must be logged in to refresh prompts');
      return;
    }

    setIsRefreshing(true);
    setProgress({ currentPrompt: '', currentModel: '', completed: 0, total: 0 });

    try {
      // Get user's onboarding data for competitor analysis
      const { data: onboardingData, error: onboardingError } = await supabase
        .from('user_onboarding')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (onboardingError) {
        console.error('Failed to fetch onboarding data:', onboardingError);
      }

      // Get all active confirmed prompts for the current user only
      const { data: confirmedPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('is_active', true)
        .eq('user_id', user.id); // Filter by current user

      if (promptsError) {
        console.error('Failed to fetch confirmed prompts:', promptsError);
        throw promptsError;
      }

      if (!confirmedPrompts || confirmedPrompts.length === 0) {
        toast.error('No active prompts found to refresh');
        return;
      }

      // Show warning for free users if they're trying to refresh with restricted models
      if (!isPro && modelType && !['openai', 'perplexity', 'gemini'].includes(modelType)) {
        toast.error('This AI model is only available for Pro users. Upgrade to Pro to access all AI models.');
        return;
      }

      // Define which models to test based on subscription status and modelType parameter
      const modelsToTest = [];
      
      // Free users can only test with OpenAI, Perplexity, and Gemini
      const allowedModelsForFree = ['openai', 'perplexity', 'gemini'];
      
      if (!modelType || modelType === 'openai') {
        if (isPro || allowedModelsForFree.includes('openai')) {
          modelsToTest.push({ name: 'OpenAI', function: 'test-prompt-openai', model: 'openai' });
        }
      }
      if (!modelType || modelType === 'perplexity') {
        if (isPro || allowedModelsForFree.includes('perplexity')) {
          modelsToTest.push({ name: 'Perplexity', function: 'test-prompt-perplexity', model: 'perplexity' });
        }
      }
      if (!modelType || modelType === 'gemini') {
        if (isPro || allowedModelsForFree.includes('gemini')) {
          modelsToTest.push({ name: 'Gemini', function: 'test-prompt-gemini', model: 'gemini' });
        }
      }
      if (!modelType || modelType === 'deepseek') {
        if (isPro) { // Only Pro users can test with DeepSeek
          modelsToTest.push({ name: 'DeepSeek', function: 'test-prompt-deepseek', model: 'deepseek' });
        }
      }
      if (!modelType || modelType === 'google-ai-overviews') {
        if (isPro) { // Only Pro users can test with Google AI Overviews
          modelsToTest.push({ name: 'Google AI Overviews', function: 'test-prompt-google-ai-overviews', model: 'google-ai-overviews' });
        }
      }

      // Check if any models are available for testing
      if (modelsToTest.length === 0) {
        if (!isPro && modelType && !['openai', 'perplexity', 'gemini'].includes(modelType)) {
          toast.error('This AI model is only available for Pro users. Upgrade to Pro to access all AI models.');
        } else {
          toast.error('No AI models available for testing. Please try again.');
        }
        return;
      }

      // Calculate total operations including TalentX Pro prompts for Pro users
      let totalOperations = confirmedPrompts.length * modelsToTest.length;
      
      // If user is Pro, add TalentX Pro prompts to the total
      if (isPro) {
        const { data: talentXPrompts, error: talentXError } = await supabase
          .from('talentx_pro_prompts')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_generated', false);

        if (talentXError) {
          console.error('Error fetching TalentX Pro prompts:', talentXError);
        } else if (talentXPrompts) {
          totalOperations += talentXPrompts.length * modelsToTest.length;
        }
      }

      let completed = 0;
      setProgress(prev => prev ? { ...prev, total: totalOperations } : null);

      // Test each prompt with selected models
      for (const confirmedPrompt of confirmedPrompts) {
        setProgress(prev => prev ? { 
          ...prev, 
          currentPrompt: confirmedPrompt.prompt_text.substring(0, 50) + '...' 
        } : null);

        for (const model of modelsToTest) {
          try {
            setProgress(prev => prev ? { ...prev, currentModel: getLLMDisplayName(model.model) } : null);
            
            const { data: responseData, error: responseError } = await supabase.functions
              .invoke(model.function, {
                body: { prompt: confirmedPrompt.prompt_text }
              });

            if (responseError) {
              console.error(`${model.name} error:`, responseError);
              toast.error(`${model.name} test failed: ${responseError.message}`);
            } else if (responseData?.response) {
              // Process response through analyze-response function to get proper analysis
              try {
                const { data: analysisData, error: analysisError } = await supabase.functions
                  .invoke('analyze-response', {
                    body: {
                      response: responseData.response,
                      companyName: companyName,
                      promptType: confirmedPrompt.prompt_type,
                      perplexityCitations: model.model === 'perplexity' ? responseData.citations : null,
                      citations: model.model === 'google-ai-overviews' ? responseData.citations : null,
                      confirmed_prompt_id: confirmedPrompt.id,
                      ai_model: model.model,
                      isTalentXPrompt: false
                    }
                  });

                if (analysisError) {
                  console.error('Error analyzing response:', analysisError);
                  // Fallback to storing with placeholder values
                  const { error: insertError } = await supabase
                    .from('prompt_responses')
                    .insert({
                      confirmed_prompt_id: confirmedPrompt.id,
                      ai_model: model.model,
                      response_text: responseData.response,
                      sentiment_score: 0,
                      sentiment_label: 'neutral',
                      citations: responseData.citations || [],
                      company_mentioned: false,
                      mention_ranking: null,
                      competitor_mentions: [],
                      first_mention_position: null,
                      total_words: responseData.response.split(' ').length,
                      visibility_score: 0,
                      competitive_score: 0,

                    });

                  if (insertError) {
                    console.error('Error storing response:', insertError);
                  }
                }
              } catch (error) {
                console.error('Error processing response analysis:', error);
                // Fallback to storing with placeholder values
                const { error: insertError } = await supabase
                  .from('prompt_responses')
                  .insert({
                    confirmed_prompt_id: confirmedPrompt.id,
                    ai_model: model.model,
                    response_text: responseData.response,
                    sentiment_score: 0,
                    sentiment_label: 'neutral',
                    citations: responseData.citations || [],
                    company_mentioned: false,
                    mention_ranking: null,
                    competitor_mentions: [],
                    first_mention_position: null,
                    total_words: responseData.response.split(' ').length,
                    visibility_score: 0,
                    competitive_score: 0,
                    detected_competitors: ''
                  });

                if (insertError) {
                  console.error('Error storing response:', insertError);
                }
              }
            }
          } catch (error) {
            console.error(`Error testing with ${model.name}:`, error);
            toast.error(`${model.name} test failed`);
          }

          completed++;
          setProgress(prev => prev ? { ...prev, completed } : null);
        }
      }

      // If user is Pro, also refresh TalentX Pro prompts
      if (isPro) {
        const { data: talentXPrompts, error: talentXError } = await supabase
          .from('talentx_pro_prompts')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_generated', false);

        if (talentXError) {
          console.error('Failed to fetch TalentX Pro prompts:', talentXError);
        } else if (talentXPrompts && talentXPrompts.length > 0) {
          for (const talentXPrompt of talentXPrompts) {
            setProgress(prev => prev ? { 
              ...prev, 
              currentPrompt: talentXPrompt.prompt_text.substring(0, 50) + '...',
              currentModel: 'TalentX Analysis'
            } : null);

            try {
              // Test the TalentX prompt with multiple models (like regular prompts)
              for (const model of modelsToTest) {
                setProgress(prev => prev ? { 
                  ...prev, 
                  currentModel: model.name,
                  currentPrompt: talentXPrompt.prompt_text.substring(0, 50) + '...'
                } : null);

                try {
                  const { data: responseData, error: responseError } = await supabase.functions
                    .invoke(model.function, {
                      body: { prompt: talentXPrompt.prompt_text }
                    });

                  if (responseError) {
                    console.error(`TalentX prompt test error with ${model.name}:`, responseError);
                  } else if (responseData?.response) {
                    // Process TalentX response through the same analyze-response function
                    // to get proper citations and competitor detection
                    try {
                      const { data: analysisData, error: analysisError } = await supabase.functions
                        .invoke('analyze-response', {
                          body: {
                            response: responseData.response,
                            companyName: companyName,
                            promptType: talentXPrompt.prompt_type,
                            perplexityCitations: model.model === 'perplexity' ? responseData.citations : null,
                            citations: model.model === 'google-ai-overviews' ? responseData.citations : null,
                            confirmed_prompt_id: talentXPrompt.id,
                            ai_model: model.model,
                            isTalentXPrompt: true,
                            talentXAttributeId: talentXPrompt.attribute_id
                          }
                        });

                      if (analysisError) {
                        console.error(`Error analyzing TalentX response with ${model.name}:`, analysisError);
                      }
                    } catch (error) {
                      console.error(`Error processing TalentX response analysis with ${model.name}:`, error);
                    }
                  }
                } catch (error) {
                  console.error(`Error testing TalentX prompt with ${model.name}:`, error);
                }

                completed++;
                setProgress(prev => prev ? { ...prev, completed } : null);
              }

              // Mark the prompt as generated after testing with all models
              await supabase
                .from('talentx_pro_prompts')
                .update({ is_generated: true })
                .eq('id', talentXPrompt.id);
            } catch (error) {
              console.error('Error processing TalentX prompt:', error);
            }
          }
        }
      }

      const finalText = isPro ? 'all prompts and TalentX Pro prompts' : 'all prompts';
              // Refreshed successfully - no toast needed

    } catch (error) {
      console.error('Error refreshing prompts:', error);
      toast.error('Failed to refresh prompts. Please try again.');
    } finally {
      setIsRefreshing(false);
      setProgress(null);
    }
  };

  return {
    isRefreshing,
    progress,
    refreshAllPrompts
  };
};
