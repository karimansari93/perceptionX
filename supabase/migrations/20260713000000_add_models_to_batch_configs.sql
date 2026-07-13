-- ============================================================================
-- Add models to company_batch_configs
-- ============================================================================
--
-- The admin "Re-collect Data" panel now confirms which LLM models a run should
-- collect responses for. Until now the chosen models only travelled in the
-- process-company-batch-queue invoke body, so they self-chained fine but were
-- lost whenever a stalled run was re-kicked by the watchdog cron (which invokes
-- the processor with no body) — those runs silently fell back to the default
-- model set.
--
-- Persisting the models on the config makes the choice durable: the processor
-- reads config.models for every claimed job, regardless of who invoked it.
-- NULL/empty = use the processor's DEFAULT_MODELS (unchanged behaviour for all
-- existing configs and flows that don't set it).
-- ============================================================================

ALTER TABLE public.company_batch_configs
  ADD COLUMN IF NOT EXISTS models TEXT[];

COMMENT ON COLUMN public.company_batch_configs.models IS
'Optional list of model names (matching test-prompt-<name> edge functions) the llm_collection phase should collect. NULL/empty = processor default set.';
