-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260603071325; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Editable collection-cycle label. NULL by default, meaning "fall back to the
-- response's own collection month". When set, it declares that this response
-- belongs to a named reporting cycle regardless of the exact tested_at/created_at
-- date. This lets a single logical collection that spans several days (or a later
-- recollection / top-up) roll up into ONE dashboard period WITHOUT rewriting any
-- collection timestamp. tested_at and created_at remain the truthful record of
-- when each model was actually queried.
ALTER TABLE public.prompt_responses
  ADD COLUMN IF NOT EXISTS collection_cycle date;

COMMENT ON COLUMN public.prompt_responses.collection_cycle IS
  'Optional reporting-cycle override (first day of cycle month). NULL = use response_month. Set to group multi-day collections / recollections into one dashboard period without altering tested_at/created_at.';

-- Group/filter dashboards by cycle efficiently (only indexes tagged rows).
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_collection_cycle
  ON public.prompt_responses (company_id, collection_cycle)
  WHERE collection_cycle IS NOT NULL;
