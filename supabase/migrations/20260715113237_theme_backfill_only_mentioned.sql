-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715113237; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Gate theme extraction on company_mentioned.
--
-- ai-thematic-analysis (real-time) now skips responses where
-- prompt_responses.company_mentioned = false. The backfill picker must apply
-- the SAME filter, otherwise every not-mentioned response forever satisfies
-- the "missing themes" anti-join and gets resubmitted (and re-billed) every
-- 5-minute tick. This also stops the junk placeholder themes ("No Company
-- Information Available", neutral company-culture) that polluted ai_themes:
-- those all came from not-mentioned responses (mostly failed
-- google-ai-overviews collections).
--
-- IMPORTANT: preserves the themes_none_found_at IS NULL filter production
-- already carries (a successful extraction with zero themes stamps the
-- response so it is never resubmitted). Both filters are required.
--
-- COALESCE guards historical rows where company_mentioned is NULL (treated
-- as not-mentioned, excluded), matching the real-time gate.

CREATE OR REPLACE FUNCTION public.find_responses_missing_themes(
    p_limit int DEFAULT 100,
    p_days  int DEFAULT 90
)
RETURNS TABLE (id uuid, company_id uuid, response_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pr.id, pr.company_id, pr.response_text
    FROM public.prompt_responses pr
    WHERE pr.tested_at >= now() - (p_days || ' days')::interval
      AND pr.response_text IS NOT NULL
      AND length(pr.response_text) > 100
      AND COALESCE(pr.for_index, false) = false
      AND COALESCE(pr.company_mentioned, false) = true
      AND pr.themes_none_found_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.ai_themes t WHERE t.response_id = pr.id
      )
    ORDER BY pr.tested_at DESC
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.find_responses_missing_themes(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_responses_missing_themes(int, int) TO service_role;
