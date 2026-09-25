import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Standard collection set, matching Company Batch and Re-collect. Used by
// Full refresh, and by Continue when a company has never been collected.
const DEFAULT_MODELS = ['openai', 'perplexity', 'google-ai-overviews', 'google-ai-mode', 'claude'];

// Every model a response can carry; Continue checks which of these the
// company's latest month actually used.
const KNOWN_MODELS = [...DEFAULT_MODELS, 'gemini', 'deepseek', 'bing-copilot'];

/**
 * What "Continue collection" should fill: the company's latest collection
 * month and the models collected in it. Continuing never adds a model the
 * company wasn't collected on, and gaps are judged within that month.
 */
async function resolveContinueScope(companyId: string): Promise<{ month: string | null; models: string[] }> {
  const { data: latest } = await supabase
    .from('prompt_responses')
    .select('response_month')
    .eq('company_id', companyId)
    .not('for_index', 'is', true)
    .order('response_month', { ascending: false })
    .limit(1)
    .maybeSingle();

  const month: string | null = (latest as any)?.response_month ?? null;
  if (!month) return { month: null, models: DEFAULT_MODELS };

  const counts = await Promise.all(
    KNOWN_MODELS.map(async (m) => {
      const { count } = await supabase
        .from('prompt_responses')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('response_month', month)
        .eq('ai_model', m)
        .not('for_index', 'is', true);
      return [m, count ?? 0] as const;
    }),
  );
  const models = counts.filter(([, c]) => c > 0).map(([m]) => m);
  return { month: month.slice(0, 7), models: models.length > 0 ? models : DEFAULT_MODELS };
}

// How many prompts to send per edge function invocation.
// With 6 models (Pro) and batchSize 1 inside the edge function,
// each chunk processes CHUNK_SIZE prompts sequentially (1 prompt × 6 models each).
// ~20-25s per prompt → 8 prompts ≈ 160-200s. Keep under 150s edge function limit.
const PROMPT_CHUNK_SIZE = 5;

/**
 * Admin-only hook: run "continue collection" (fill gaps) or "full refresh" for a company.
 * Continue fills the company's latest month on the models it was collected
 * with; Full refresh re-asks everything on DEFAULT_MODELS. Invokes collect-company-responses
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
        // Continue = same models, same month, only the gaps. Full refresh
        // (skipExisting false) re-asks everything on the standard models.
        let modelNames = DEFAULT_MODELS;
        let skipMonth = options.skipIfCollectedInMonth ?? null;
        if (options.skipExisting && !options.promptIds) {
          const scope = await resolveContinueScope(companyId);
          modelNames = scope.models;
          skipMonth = skipMonth ?? scope.month;
        }

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
        toast.info(
          `${label}: ${companyName} on ${modelNames.join(', ')}${skipMonth ? ` (filling ${skipMonth})` : ''}. Up to ${totalOps} operations in ${totalChunks} chunks.`
        );

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
              skipIfCollectedInMonth: skipMonth,
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
