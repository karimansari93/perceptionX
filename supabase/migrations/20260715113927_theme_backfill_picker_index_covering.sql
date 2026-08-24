-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715113927; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Second-stage tuning of the backfill picker: 12s -> sub-second.
--
-- The anti-join must inspect ~10k recent candidates to find the few without
-- themes. With the previous shape, every inspected candidate pulled its FULL
-- row (incl. response_text, width ~421) from the heap. Fix: make the
-- candidate walk index-only (covering partial index carrying id/company_id;
-- length() check baked into the predicate), and fetch wide rows only for the
-- LIMITed winners.

DROP INDEX IF EXISTS public.idx_prompt_responses_tested_at_missing_themes;

CREATE INDEX idx_prompt_responses_tested_at_missing_themes
ON public.prompt_responses USING btree (tested_at DESC)
INCLUDE (id, company_id)
WHERE response_text IS NOT NULL
  AND length(response_text) > 100
  AND COALESCE(for_index, false) = false
  AND COALESCE(company_mentioned, false) = true
  AND themes_none_found_at IS NULL;

CREATE OR REPLACE FUNCTION public.find_responses_missing_themes(
    p_limit int DEFAULT 100,
    p_days  int DEFAULT 90
)
RETURNS TABLE (id uuid, company_id uuid, response_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
    WITH candidates AS (
        SELECT p.id, p.company_id, p.tested_at
        FROM public.prompt_responses p
        WHERE p.tested_at >= now() - (p_days || ' days')::interval
          AND p.response_text IS NOT NULL
          AND length(p.response_text) > 100
          AND COALESCE(p.for_index, false) = false
          AND COALESCE(p.company_mentioned, false) = true
          AND p.themes_none_found_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.ai_themes t WHERE t.response_id = p.id
          )
        ORDER BY p.tested_at DESC
        LIMIT p_limit
    )
    SELECT c.id, c.company_id, pr.response_text
    FROM candidates c
    JOIN public.prompt_responses pr ON pr.id = c.id
    ORDER BY c.tested_at DESC;
$$;

REVOKE ALL ON FUNCTION public.find_responses_missing_themes(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_responses_missing_themes(int, int) TO service_role;

-- Refresh the visibility map so the covering index actually scans index-only.
ANALYZE public.prompt_responses;
