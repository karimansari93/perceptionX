import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const FREE_MODELS = ['openai', 'perplexity', 'google-ai-overviews'];
const PRO_MODELS = ['openai', 'perplexity', 'gemini', 'deepseek', 'google-ai-overviews'];

/**
 * Admin-only hook: run "continue collection" (fill gaps) or "full refresh" for a company.
 * Resolves models from org owner's subscription and invokes collect-company-responses.
 */
export function useAdminCompanyCollection() {
  const [isRunning, setIsRunning] = useState(false);

  const runCollection = useCallback(
    async (
      companyId: string,
      organizationId: string,
      companyName: string,
      options: { skipExisting: boolean }
    ): Promise<boolean> => {
      setIsRunning(true);
      try {
        const { data: orgMember, error: orgMemberError } = await supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', organizationId)
          .eq('role', 'owner')
          .limit(1)
          .single();

        let isProUser = false;
        if (!orgMemberError && orgMember?.user_id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_type')
            .eq('id', orgMember.user_id)
            .single();
          isProUser = profile?.subscription_type === 'pro';
        }

        const modelNames = isProUser ? PRO_MODELS : FREE_MODELS;

        const { data: allPrompts, error: promptsError } = await supabase
          .from('confirmed_prompts')
          .select('id')
          .eq('is_active', true)
          .eq('company_id', companyId);

        if (promptsError || !allPrompts?.length) {
          toast.error('No active prompts found for this company');
          return false;
        }

        const promptIds = allPrompts.map((p) => p.id);
        const totalOps = promptIds.length * modelNames.length;
        const label = options.skipExisting ? 'Continue collection' : 'Full refresh';
        toast.info(`${label}: ${totalOps} operations for ${companyName}`);

        const { data, error } = await supabase.functions.invoke('collect-company-responses', {
          body: {
            companyId,
            promptIds,
            models: modelNames,
            batchSize: 5,
            skipExisting: options.skipExisting,
          },
        });

        if (error) {
          throw new Error(error.message || 'Collection failed');
        }
        if (!data?.success) {
          throw new Error(data?.error || 'Collection failed');
        }

        const { results } = data;
        if (results?.errors?.length > 0) {
          toast.warning(
            `Completed with ${results.errors.length} errors. ${results.responsesCollected ?? 0} responses collected.`
          );
        } else {
          toast.success(
            `Done! Processed ${results?.promptsProcessed ?? 0} prompts, ${results?.responsesCollected ?? 0} responses collected.`
          );
        }
        return true;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        toast.error(`${options.skipExisting ? 'Continue collection' : 'Full refresh'} failed: ${message}`);
        return false;
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  const runContinueCollection = useCallback(
    (companyId: string, organizationId: string, companyName: string) =>
      runCollection(companyId, organizationId, companyName, { skipExisting: true }),
    [runCollection]
  );

  const runFullRefresh = useCallback(
    (companyId: string, organizationId: string, companyName: string) =>
      runCollection(companyId, organizationId, companyName, { skipExisting: false }),
    [runCollection]
  );

  return { runContinueCollection, runFullRefresh, runCollection, isRunning };
}
