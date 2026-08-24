-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260603072720; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Make response_month cycle-aware: prefer the explicit collection_cycle label
-- when set, else fall back to the month the row was created (the prior behavior).
-- This makes every surface that keys on response_month (sentiment/relevance MVs,
-- dashboard, reports) agree on a single collection cycle, without altering the
-- truthful created_at / tested_at timestamps. response_month remains a STORED
-- generated column; only its formula changes.
ALTER TABLE public.prompt_responses
  ALTER COLUMN response_month
  SET EXPRESSION AS (
    COALESCE(
      collection_cycle,
      (date_trunc('month'::text, (created_at AT TIME ZONE 'UTC'::text)))::date
    )
  );
