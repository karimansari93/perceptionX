-- Editable collection-cycle label for prompt_responses.
--
-- NULL by default, meaning "fall back to the response's own collection month".
-- When set, it declares that this response belongs to a named reporting cycle
-- regardless of the exact tested_at/created_at date. This lets a single logical
-- collection that spans several days (a run that crosses a calendar-month
-- boundary, or a later recollection / top-up) roll up into ONE dashboard period
-- WITHOUT rewriting any collection timestamp. tested_at and created_at remain the
-- truthful record of when each model was actually queried.
--
-- The dashboard period grouping (useDashboardData.periodKeyOf) reads this column:
-- collection_cycle when present, else the month of tested_at.

ALTER TABLE public.prompt_responses
  ADD COLUMN IF NOT EXISTS collection_cycle date;

COMMENT ON COLUMN public.prompt_responses.collection_cycle IS
  'Optional reporting-cycle override (first day of cycle month). NULL = use response_month. Set to group multi-day collections / recollections into one dashboard period without altering tested_at/created_at.';

-- Group/filter dashboards by cycle efficiently (partial index: only tagged rows).
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_collection_cycle
  ON public.prompt_responses (company_id, collection_cycle)
  WHERE collection_cycle IS NOT NULL;
