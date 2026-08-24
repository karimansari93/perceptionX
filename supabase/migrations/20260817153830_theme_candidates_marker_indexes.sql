-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817153830; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Swap theme-candidate partial indexes to _v2 versions whose predicates also
-- exclude rows already marked processed (themes_found_at IS NULL), so empty
-- polls of find_responses_missing_themes touch almost nothing.
-- Plain (non-concurrent) builds: run while collection_active() is false.

DROP INDEX IF EXISTS public.idx_prompt_responses_tested_at_missing_themes_v2;
DROP INDEX IF EXISTS public.idx_pr_cycle_theme_candidates_v2;

CREATE INDEX idx_prompt_responses_tested_at_missing_themes_v2
ON public.prompt_responses USING btree (tested_at DESC) INCLUDE (id, company_id)
WHERE response_text IS NOT NULL
  AND length(response_text) > 100
  AND COALESCE(for_index, false) = false
  AND COALESCE(company_mentioned, false) = true
  AND themes_none_found_at IS NULL
  AND themes_found_at IS NULL;

CREATE INDEX idx_pr_cycle_theme_candidates_v2
ON public.prompt_responses USING btree (collection_cycle) INCLUDE (id, company_id)
WHERE response_text IS NOT NULL
  AND length(response_text) > 100
  AND COALESCE(for_index, false) = false
  AND COALESCE(company_mentioned, false) = true
  AND themes_none_found_at IS NULL
  AND themes_found_at IS NULL;

DROP INDEX IF EXISTS public.idx_prompt_responses_tested_at_missing_themes;
DROP INDEX IF EXISTS public.idx_pr_cycle_theme_candidates;
