-- Performance fix for the backfill picker after the company_mentioned gate.
--
-- Applied to production 2026-07-15 (as theme_backfill_picker_index +
-- theme_backfill_picker_index_covering). Two problems surfaced when the
-- gate landed:
--   1. The partial index idx_prompt_responses_tested_at_missing_themes
--      predated the new predicate (company_mentioned / themes_none_found_at),
--      so the picker walked a much wider candidate set.
--   2. The anti-join pulled the FULL row (incl. response_text, ~421 bytes
--      wide) for every candidate it inspected — ~10k heap reads to find the
--      ~100 theme-less winners. Cold-cache runs hit 18s and the tick's
--      statement timeout, killing the safety-net cron on every fire.
--
-- Fix: bake the full predicate into a covering partial index
-- (INCLUDE id/company_id, length() in the predicate) so the candidate walk
-- and anti-join run index-only, and fetch wide rows only for the LIMITed
-- winners. Also give the function its own statement_timeout headroom.
-- Result: 18.5s -> ~3.6s cold, sub-second warm.

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
