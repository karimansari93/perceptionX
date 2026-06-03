-- Make response_month cycle-aware.
--
-- response_month is a STORED generated column. Previously it was derived purely
-- from created_at. Now it prefers the explicit collection_cycle label when set,
-- and otherwise falls back to the created_at month exactly as before. This makes
-- every surface that keys on response_month agree on a single collection cycle,
-- without altering the truthful created_at / tested_at timestamps.
--
-- Requires collection_cycle (see 20260603000000_add_collection_cycle_to_prompt_responses.sql).
ALTER TABLE public.prompt_responses
  ALTER COLUMN response_month
  SET EXPRESSION AS (
    COALESCE(
      collection_cycle,
      (date_trunc('month'::text, (created_at AT TIME ZONE 'UTC'::text)))::date
    )
  );
