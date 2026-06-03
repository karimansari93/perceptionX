-- ============================================================================
-- Add skip_if_collected_in_month to company_batch_configs
-- ============================================================================
--
-- process-company-batch-queue (the server-side collection driver) already reads
-- config.skip_if_collected_in_month and forwards it to collect-company-responses
-- as skipIfCollectedInMonth. With it set to "YYYY-MM", the llm_collection phase
-- only collects a (prompt, model) pair if it has no response IN THAT MONTH —
-- i.e. it fills the month's gaps instead of skipping any prompt that has ever
-- been collected.
--
-- The column was introduced in 20260422000001_monthly_auto_refresh.sql, but that
-- migration was never applied to this project, so the admin "Re-collect Data"
-- panel can't drive month-aware server-side recollection. This adds just the
-- column (nullable, no behavioural side effects on its own).
-- ============================================================================

ALTER TABLE public.company_batch_configs
  ADD COLUMN IF NOT EXISTS skip_if_collected_in_month TEXT;

COMMENT ON COLUMN public.company_batch_configs.skip_if_collected_in_month IS
'Optional "YYYY-MM". When set, process-company-batch-queue passes this to collect-company-responses so prompts only re-run if they lack a response in that specific month.';
