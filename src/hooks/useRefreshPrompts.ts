import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getLLMDisplayName } from '@/config/llmLogos';

interface RefreshProgress {
  currentPrompt: string;
  currentModel: string;
  completed: number;
  total: number;
}

export const useRefreshPrompts = () => {
  const { user } = useAuth();
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
      console.log('Starting refresh of prompts...', modelType ? `for ${modelType} only` : 'for all models');
      
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

      // Define which models to test based on the modelType parameter
      const modelsToTest = [];
      if (!modelType || modelType === 'openai') {
        modelsToTest.push({ name: 'OpenAI', function: 'test-prompt-openai', model: 'gpt-4o-mini' });
      }
      if (!modelType || modelType === 'perplexity') {
        modelsToTest.push({ name: 'Perplexity', function: 'test-prompt-perplexity', model: 'llama-3.1-sonar-small-128k-online' });
      }
      if (!modelType || modelType === 'gemini') {
        modelsToTest.push({ name: 'Gemini', function: 'test-prompt-gemini', model: 'gemini-1.5-flash' });
      }
      if (!modelType || modelType === 'deepseek') {
        modelsToTest.push({ name: 'DeepSeek', function: 'test-prompt-deepseek', model: 'deepseek-chat' });
      }

      const totalOperations = confirmedPrompts.length * modelsToTest.length;
      let completed = 0;

      setProgress(prev => prev ? { ...prev, total: totalOperations } : null);

      // Test each prompt with selected models
      for (const confirmedPrompt of confirmedPrompts) {
        console.log('Testing prompt:', confirmedPrompt.prompt_text);
        
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
              // Handle citations from Perplexity responses
              const perplexityCitations = model.name === 'Perplexity' ? responseData.citations : null;
              
              // Analyze sentiment and extract citations with enhanced analysis
              const { data: sentimentData, error: sentimentError } = await supabase.functions
                .invoke('analyze-response', {
                  body: { 
                    response: responseData.response,
                    companyName: companyName,
                    promptType: confirmedPrompt.prompt_type,
                    perplexityCitations: perplexityCitations
                  }
                });

              if (sentimentError) {
                console.error('Sentiment analysis error:', sentimentError);
              }

              // Combine Perplexity citations with analyzed citations
              let finalCitations = sentimentData?.citations || [];
              if (perplexityCitations && perplexityCitations.length > 0) {
                // Add Perplexity citations to the beginning of the array
                finalCitations = [...perplexityCitations, ...finalCitations];
              }

              // Store the response with enhanced visibility metrics
              await supabase
                .from('prompt_responses')
                .insert({
                  confirmed_prompt_id: confirmedPrompt.id,
                  ai_model: model.model,
                  response_text: responseData.response,
                  sentiment_score: sentimentData?.sentiment_score || 0,
                  sentiment_label: sentimentData?.sentiment_label || 'neutral',
                  citations: finalCitations,
                  company_mentioned: sentimentData?.company_mentioned || false,
                  mention_ranking: sentimentData?.mention_ranking || null,
                  competitor_mentions: sentimentData?.competitor_mentions || [],
                  workplace_themes: sentimentData?.workplace_themes || []
                });
            }
          } catch (error) {
            console.error(`Error testing with ${model.name}:`, error);
            toast.error(`${model.name} test failed`);
          }

          completed++;
          setProgress(prev => prev ? { ...prev, completed } : null);
        }
      }

      const modelText = modelType ? `${modelType} prompts` : 'all prompts';
      console.log(`${modelText} refreshed successfully`);
      toast.success(`${modelText} refreshed successfully!`);

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
