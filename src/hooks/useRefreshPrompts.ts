import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';

export interface RefreshProgress {
  currentPrompt: string;
  currentModel: string;
  completed: number;
  total: number;
}

interface RefreshOptions {
  modelType?: string;
  promptIds?: string[];
  companyId?: string;
}

const FREE_MODELS = ['openai', 'perplexity', 'google-ai-overviews'];
const PRO_MODELS = ['openai', 'perplexity', 'google-ai-overviews', 'gemini', 'deepseek'];

export const useRefreshPrompts = () => {
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);

  const refreshAllPrompts = async (companyName: string, options: RefreshOptions = {}) => {
    const { modelType, promptIds, companyId: optionsCompanyId } = options;
    if (!user) {
      toast.error('You must be logged in to refresh prompts');
      return;
    }

    setIsRefreshing(true);
    setProgress({ currentPrompt: '', currentModel: '', completed: 0, total: 0 });

    try {
      // Restrict free users to allowed models
      if (!isPro && modelType && !FREE_MODELS.includes(modelType)) {
        toast.error('This AI model is only available for Pro users. Upgrade to Pro to access all AI models.');
        return;
      }

      const modelNames = modelType
        ? [modelType]
        : isPro
          ? PRO_MODELS
          : FREE_MODELS;

      if (modelNames.length === 0) {
        toast.error('No AI models available for testing. Please try again.');
        return;
      }

      // Get active confirmed prompts to refresh
      let promptQuery = supabase
        .from('confirmed_prompts')
        .select('id, company_id')
        .eq('is_active', true)
        .eq('user_id', user.id);

      if (promptIds && promptIds.length > 0) {
        promptQuery = promptQuery.in('id', promptIds);
      }

      const { data: confirmedPrompts, error: promptsError } = await promptQuery;

      if (promptsError) {
        console.error('Failed to fetch confirmed prompts:', promptsError);
        throw promptsError;
      }

      if (!confirmedPrompts || confirmedPrompts.length === 0) {
        toast.error('No active prompts found to refresh');
        return;
      }

      // Group prompts by company_id so we can call collect-company-responses once per company
      const byCompany = new Map<string, string[]>();
      for (const p of confirmedPrompts) {
        const cid = p.company_id ?? '';
        if (!byCompany.has(cid)) byCompany.set(cid, []);
        byCompany.get(cid)!.push(p.id);
      }

      // When promptIds were provided (e.g. after add industry), process all companies that own those prompts (usually one).
      // When doing full refresh (no promptIds), scope to companyId if provided so we only refresh current company.
      let companiesToProcess: [string, string[]][];
      if (promptIds && promptIds.length > 0) {
        companiesToProcess = Array.from(byCompany.entries());
      } else if (optionsCompanyId != null && byCompany.has(optionsCompanyId)) {
        companiesToProcess = [[optionsCompanyId, byCompany.get(optionsCompanyId)!]];
      } else if (optionsCompanyId != null) {
        companiesToProcess = [];
      } else {
        companiesToProcess = Array.from(byCompany.entries());
      }

      if (companiesToProcess.length === 0) {
        toast.error('No prompts found for this company to refresh');
        return;
      }

      let totalOperations = 0;
      for (const [, ids] of companiesToProcess) {
        totalOperations += ids.length * modelNames.length;
      }

      setProgress(prev =>
        prev ? { ...prev, total: totalOperations, currentPrompt: 'Starting batch collection…' } : null
      );

      let totalCompleted = 0;
      const allErrors: string[] = [];
      let totalPromptsProcessed = 0;
      let totalResponsesCollected = 0;

      for (const [companyId, idsForCompany] of companiesToProcess) {
        const { data, error } = await supabase.functions.invoke('collect-company-responses', {
          body: {
            companyId,
            promptIds: idsForCompany,
            models: modelNames,
            batchSize: 5,
            skipExisting: true,
          },
        });

        if (error) {
          console.error('Batch collection error:', error);
          throw new Error(error.message || 'Collection failed');
        }

        if (!data?.success) {
          throw new Error(data?.error || 'Collection failed');
        }

        const summary = data.summary ?? {};
        const results = data.results ?? {};
        totalPromptsProcessed += summary.totalPrompts ?? results.promptsProcessed ?? 0;
        totalResponsesCollected += results.responsesCollected ?? 0;
        if (Array.isArray(results.errors)) {
          allErrors.push(...results.errors);
        }
        totalCompleted += (summary.totalPrompts ?? idsForCompany.length) * modelNames.length;
        setProgress(prev =>
          prev ? { ...prev, completed: totalCompleted, currentPrompt: 'Collecting AI responses…' } : null
        );
      }

      setProgress(prev => (prev ? { ...prev, completed: prev.total, currentPrompt: 'Complete' } : null));

      if (allErrors.length > 0) {
        toast.warning(
          `Refresh completed with ${allErrors.length} error(s). ${totalResponsesCollected} responses collected.`
        );
      }
    } catch (error: any) {
      console.error('Error refreshing prompts:', error);
      toast.error(error?.message ?? 'Failed to refresh prompts. Please try again.');
    } finally {
      setIsRefreshing(false);
      setProgress(null);
    }
  };

  return {
    isRefreshing,
    progress,
    refreshAllPrompts,
  };
};
