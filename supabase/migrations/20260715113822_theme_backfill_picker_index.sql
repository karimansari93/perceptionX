-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715113822; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Retune the backfill picker's partial index for the new predicate.
--
-- find_responses_missing_themes() now also filters
-- COALESCE(company_mentioned,false)=true AND themes_none_found_at IS NULL.
-- The old partial index (response_text IS NOT NULL AND for_index=false)
-- forced those as row filters on top of a wide tested_at walk; combined with
-- the anti-join probe per row the picker ran ~18s and hit statement timeout.
-- Bake the full predicate into the index so the walk only touches rows that
-- are actually candidates.

DROP INDEX IF EXISTS public.idx_prompt_responses_tested_at_missing_themes;

CREATE INDEX idx_prompt_responses_tested_at_missing_themes
ON public.prompt_responses USING btree (tested_at DESC)
WHERE response_text IS NOT NULL
  AND COALESCE(for_index, false) = false
  AND COALESCE(company_mentioned, false) = true
  AND themes_none_found_at IS NULL;
