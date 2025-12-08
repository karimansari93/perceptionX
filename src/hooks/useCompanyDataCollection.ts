import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { toast } from 'sonner';
import { generatePromptsFromData } from '@/hooks/usePromptsLogic';
import { useSubscription } from '@/hooks/useSubscription';

export interface CollectionProgress {
  currentPrompt: string;
  currentModel: string;
  completed: number;
  total: number;
}

interface CollectionStatus {
  status: 'pending' | 'collecting_search_insights' | 'collecting_llm_data' | 'completed' | 'failed';
  progress: CollectionProgress | null;
  companyId: string;
  companyName: string;
  onboardingId: string | null;
}

export const useCompanyDataCollection = () => {
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const { isPro } = useSubscription();
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectionStatus, setCollectionStatus] = useState<CollectionStatus | null>(null);
  const [progress, setProgress] = useState<CollectionProgress | null>(null);

  // Check for incomplete collection on mount and when company changes
  useEffect(() => {
    const checkIncompleteCollection = async () => {
      if (!user?.id || !currentCompany?.id) {
        console.log('[Collection] Skipping check - missing user or company', { userId: user?.id, companyId: currentCompany?.id });
        return;
      }

      console.log('[Collection] Checking for incomplete collection for company:', currentCompany.id);

      try {
        const { data: company, error } = await supabase
          .from('companies')
          .select('id, name, data_collection_status, data_collection_progress, onboarding_id')
          .eq('id', currentCompany.id)
          .single();

        if (error) {
          // If column doesn't exist, migration hasn't been run
          if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
            console.warn('[Collection] Migration not applied yet. Please run the migration:', error);
            return;
          }
          console.error('[Collection] Error checking collection status:', error);
          return;
        }

        console.log('[Collection] Company data:', {
          id: company?.id,
          name: company?.name,
          status: company?.data_collection_status,
          progress: company?.data_collection_progress
        });

        // Check if status exists and is incomplete (null means completed for old companies)
        if (company && 
            company.data_collection_status && 
            company.data_collection_status !== 'completed' && 
            company.data_collection_status !== 'failed' &&
            company.data_collection_status !== null) {
          
          console.log('[Collection] Found incomplete collection! Status:', company.data_collection_status);
          const progressData = company.data_collection_progress as any;
          
          // Ensure progress has valid values
          const validProgress = progressData && typeof progressData === 'object' 
            ? {
                currentPrompt: progressData.currentPrompt || '',
                currentModel: progressData.currentModel || '',
                completed: typeof progressData.completed === 'number' ? progressData.completed : 0,
                total: typeof progressData.total === 'number' ? progressData.total : 0
              }
            : null;
          
          setCollectionStatus({
            status: company.data_collection_status,
            progress: validProgress,
            companyId: company.id,
            companyName: company.name,
            onboardingId: company.onboarding_id
          });
          setProgress(validProgress);
          setIsCollecting(true);
        } else {
          console.log('[Collection] No incomplete collection found. Status:', company?.data_collection_status);
        }
      } catch (error) {
        console.error('[Collection] Error in checkIncompleteCollection:', error);
      }
    };

    checkIncompleteCollection();
  }, [user?.id, currentCompany?.id]);

  // Resume collection process
  const resumeCollection = useCallback(async () => {
    if (!collectionStatus || !user || isCollecting) {
      console.log('[Collection] Skipping resume - conditions not met', {
        hasStatus: !!collectionStatus,
        hasUser: !!user,
        isCollecting
      });
      return;
    }

    console.log('[Collection] Resuming collection for company:', collectionStatus.companyId);
    setIsCollecting(true);

    try {
      // Get onboarding data
      let onboardingData = null;
      if (collectionStatus.onboardingId) {
        const { data, error } = await supabase
          .from('user_onboarding')
          .select('*')
          .eq('id', collectionStatus.onboardingId)
          .single();

        if (error) throw error;
        onboardingData = data;
      } else {
        // Fallback: get latest onboarding for this company
        const { data, error } = await supabase
          .from('user_onboarding')
          .select('*')
          .eq('user_id', user.id)
          .eq('company_name', collectionStatus.companyName)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error) throw error;
        onboardingData = data;
      }

      if (!onboardingData) {
        throw new Error('Could not find onboarding data');
      }

      // Get confirmed prompts
      const { data: confirmedPrompts, error: promptsError } = await supabase
        .from('confirmed_prompts')
        .select('*')
        .eq('onboarding_id', onboardingData.id)
        .eq('is_active', true);

      if (promptsError) throw promptsError;
      if (!confirmedPrompts || confirmedPrompts.length === 0) {
        throw new Error('No prompts found');
      }

      // Define AI models
      const models = [
        { name: 'openai', functionName: 'test-prompt-openai', displayName: 'ChatGPT' },
        { name: 'perplexity', functionName: 'test-prompt-perplexity', displayName: 'Perplexity' },
        { name: 'google-ai-overviews', functionName: 'test-prompt-google-ai-overviews', displayName: 'Google AI' }
      ];

      // Resume based on status
      if (collectionStatus.status === 'pending' || collectionStatus.status === 'collecting_search_insights') {
        // Start with search insights
        await supabase
          .from('companies')
          .update({ 
            data_collection_status: 'collecting_search_insights',
            data_collection_started_at: new Date().toISOString()
          })
          .eq('id', collectionStatus.companyId);

        const { error: searchError } = await supabase.functions.invoke('search-insights', {
          body: {
            companyName: collectionStatus.companyName,
            company_id: collectionStatus.companyId,
            onboarding_id: onboardingData.id
          }
        });

        if (searchError) {
          console.error('Search insights error:', searchError);
        }
      }

      // Calculate total operations
      const totalOperations = confirmedPrompts.length * models.length;
      
      // Move to LLM data collection
      await supabase
        .from('companies')
        .update({ 
          data_collection_status: 'collecting_llm_data',
          data_collection_progress: {
            currentPrompt: 'Starting AI analysis...',
            currentModel: '',
            completed: 0,
            total: totalOperations
          }
        })
        .eq('id', collectionStatus.companyId);
      
      // Initialize progress state
      setProgress({
        currentPrompt: 'Starting AI analysis...',
        currentModel: '',
        completed: 0,
        total: totalOperations
      });
      let completedOperations = 0;

      // Check which prompts/models have already been completed
      const { data: existingResponses } = await supabase
        .from('prompt_responses')
        .select('confirmed_prompt_id, ai_model')
        .in('confirmed_prompt_id', confirmedPrompts.map(p => p.id));

      const completedSet = new Set(
        (existingResponses || []).map(r => `${r.confirmed_prompt_id}-${r.ai_model}`)
      );

      // Run AI prompts
      for (const prompt of confirmedPrompts) {
        for (const model of models) {
          const key = `${prompt.id}-${model.name}`;
          
          // Skip if already completed
          if (completedSet.has(key)) {
            completedOperations++;
            setProgress({
              currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
              currentModel: model.displayName,
              completed: completedOperations,
              total: totalOperations,
            });
            continue;
          }

          try {
            setProgress({
              currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
              currentModel: model.displayName,
              completed: completedOperations,
              total: totalOperations,
            });

            await supabase
              .from('companies')
              .update({ 
                data_collection_progress: {
                  currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
                  currentModel: model.displayName,
                  completed: completedOperations,
                  total: totalOperations
                }
              })
              .eq('id', collectionStatus.companyId);

            const { data: responseData, error: functionError } = await supabase.functions.invoke(model.functionName, {
              body: { prompt: prompt.prompt_text }
            });

            if (functionError) {
              console.error(`${model.functionName} error:`, functionError);
              completedOperations++;
              continue;
            }

            if (responseData?.response) {
              const perplexityCitations = model.name === 'perplexity' ? responseData.citations : null;
              const googleAICitations = model.name === 'google-ai-overviews' ? responseData.citations : null;

              const { error: analyzeError } = await supabase.functions.invoke('analyze-response', {
                body: {
                  response: responseData.response,
                  companyName: collectionStatus.companyName,
                  promptType: prompt.prompt_type,
                  perplexityCitations: perplexityCitations,
                  citations: googleAICitations,
                  confirmed_prompt_id: prompt.id,
                  ai_model: model.name,
                  company_id: collectionStatus.companyId,
                }
              });

              if (analyzeError) {
                console.error('Analyze error:', analyzeError);
              }
            }

            completedOperations++;
            setProgress({
              currentPrompt: prompt.prompt_text.substring(0, 100) + '...',
              currentModel: model.displayName,
              completed: completedOperations,
              total: totalOperations,
            });

          } catch (error) {
            console.error(`Error testing ${model.name}:`, error);
            completedOperations++;
          }
        }
      }

      // Mark as completed
      await supabase
        .from('companies')
        .update({ 
          data_collection_status: 'completed',
          data_collection_completed_at: new Date().toISOString(),
          data_collection_progress: null
        })
        .eq('id', collectionStatus.companyId);

      toast.success('Company data collection completed!');
      setCollectionStatus(null);
      setProgress(null);
      setIsCollecting(false);

    } catch (error) {
      console.error('Error resuming collection:', error);
      toast.error('Failed to resume data collection');
      
      await supabase
        .from('companies')
        .update({ data_collection_status: 'failed' })
        .eq('id', collectionStatus.companyId);
      
      setIsCollecting(false);
    }
  }, [collectionStatus, user, isCollecting]);

  return {
    isCollecting,
    collectionStatus,
    progress,
    resumeCollection
  };
};

