-- Gate theme extraction on company_mentioned.
--
-- analyze-response only triggers ai-thematic-analysis when
-- prompt_responses.company_mentioned = true. Responses that never mention the
-- company yield an empty theme array anyway (see the coverage rule in
-- supabase/functions/_shared/theme-analysis.ts), so skipping the model call
-- is a pure cost saving with no loss of themes.
--
-- The safety-net backfill picker must apply the SAME filter. Otherwise every
-- company_mentioned=false response would forever satisfy the "missing themes"
-- anti-join (it will never get themes), and theme-backfill-tick would re-send
-- it on every 5-minute tick — turning the cost saving into a cost increase.
--
-- IMPORTANT: this definition preserves the themes_none_found_at IS NULL
-- filter that production already carries (added with the batch-era backfill:
-- a successful extraction with zero themes stamps the response so it is
-- never resubmitted). Both filters are required.
--
-- COALESCE guards historical rows where company_mentioned is NULL (treated
-- as not-mentioned → excluded), matching the real-time gate.

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
