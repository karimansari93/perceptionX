import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const PRO_MODELS = ['openai', 'perplexity', 'gemini', 'deepseek', 'google-ai-overviews', 'google-ai-mode'];

// How many prompts to send per edge function invocation.
// With 6 models (Pro) and batchSize 1 inside the edge function,
// each chunk processes CHUNK_SIZE prompts sequentially (1 prompt × 6 models each).
// ~20-25s per prompt → 8 prompts ≈ 160-200s. Keep under 150s edge function limit.
const PROMPT_CHUNK_SIZE = 5;

/**
 * Admin-only hook: run "continue collection" (fill gaps) or "full refresh" for a company.
 * Resolves models from org owner's subscription and invokes collect-company-responses
 * in chunks to avoid Supabase edge function timeouts (150s limit).
 */
export function useAdminCompanyCollection() {
  const [isRunning, setIsRunning] = useState(false);

  const runCollection = useCallback(
    async (
      companyId: string,
      organizationId: string,
      companyName: string,
      options: {
        skipExisting: boolean;
        // When provided, ONLY these prompts are collected instead of every
        // active prompt for the company. Used by the "Recollect missing" flow
        // to re-run just the prompts that have no response for a given month.
        promptIds?: string[];
        // Optional "YYYY-MM". Forwarded to collect-company-responses so a prompt
        // counts as "already collected" only if it has a response in that month.
        // Note: the edge function only applies this when skipExisting is true.
        skipIfCollectedInMonth?: string | null;
      }
    ): Promise<boolean> => {
      setIsRunning(true);
      try {
        const modelNames = PRO_MODELS;

        let promptIds: string[];
        if (options.promptIds) {
          // Caller supplied an explicit target set (e.g. only the missing
          // prompts). An empty set means there's nothing to do.
          if (options.promptIds.length === 0) {
            toast.info(`${companyName}: nothing to collect — already complete.`);
            return true;
          }
          promptIds = options.promptIds;
        } else {
          const { data: allPrompts, error: promptsError } = await supabase
            .from('confirmed_prompts')
            .select('id')
            .eq('is_active', true)
            .eq('company_id', companyId);

          if (promptsError || !allPrompts?.length) {
            toast.error('No active prompts found for this company');
            return false;
          }
          promptIds = allPrompts.map((p) => p.id);
        }

        const totalOps = promptIds.length * modelNames.length;
        const totalChunks = Math.ceil(promptIds.length / PROMPT_CHUNK_SIZE);
        const label = options.promptIds
          ? 'Recollect missing'
          : options.skipExisting ? 'Continue collection' : 'Full refresh';
        toast.info(`${label}: ${totalOps} operations for ${companyName} (${totalChunks} chunks)`);

        let totalCollected = 0;
        let totalErrors: string[] = [];
        let totalProcessed = 0;

        // Process prompts in chunks — each chunk is a separate edge function invocation
        // so we stay well under the 150s timeout.
        for (let i = 0; i < promptIds.length; i += PROMPT_CHUNK_SIZE) {
          const chunk = promptIds.slice(i, i + PROMPT_CHUNK_SIZE);
          const chunkNum = Math.floor(i / PROMPT_CHUNK_SIZE) + 1;

          console.log(`[Collection] Chunk ${chunkNum}/${totalChunks}: ${chunk.length} prompts`);

          const { data, error } = await supabase.functions.invoke('collect-company-responses', {
            body: {
              companyId,
              promptIds: chunk,
              models: modelNames,
              batchSize: 1,
              skipExisting: options.skipExisting,
              skipIfCollectedInMonth: options.skipIfCollectedInMonth ?? null,
            },
          });

          if (error) {
            console.error(`[Collection] Chunk ${chunkNum} error:`, error.message);
            totalErrors.push(`Chunk ${chunkNum}: ${error.message}`);
            // Continue to next chunk — don't abort the whole collection
            continue;
          }

          if (!data?.success) {
            console.error(`[Collection] Chunk ${chunkNum} failed:`, data?.error);
            totalErrors.push(`Chunk ${chunkNum}: ${data?.error || 'Unknown error'}`);
            continue;
          }

          const { results } = data;
          totalCollected += results?.responsesCollected ?? 0;
          totalProcessed += results?.promptsProcessed ?? 0;
          if (results?.errors?.length > 0) {
            totalErrors.push(...results.errors);
          }
        }

        if (totalErrors.length > 0) {
          toast.warning(
            `Completed with ${totalErrors.length} errors. ${totalCollected} responses collected.`
          );
        } else {
          toast.success(
            `Done! Processed ${totalProcessed} prompts, ${totalCollected} responses collected.`
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
