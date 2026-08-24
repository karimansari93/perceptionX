-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811103809; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Candidate scan for the readiness check becomes index-only: the predicate
-- (including the length() check, which otherwise detoasts every large row) is
-- baked into the partial index, keyed by cycle.
CREATE INDEX IF NOT EXISTS idx_pr_cycle_theme_candidates
  ON public.prompt_responses (collection_cycle)
  INCLUDE (id, company_id)
  WHERE response_text IS NOT NULL
    AND length(response_text) > 100
    AND COALESCE(for_index, false) = false
    AND COALESCE(company_mentioned, false) = true
    AND themes_none_found_at IS NULL;
