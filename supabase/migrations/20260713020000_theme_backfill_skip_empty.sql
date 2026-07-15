-- Stop re-billing responses that legitimately yield zero themes.
--
-- A large share of prompt_responses (ranking lists, competitor-only answers)
-- correctly produce an empty theme array. They never get ai_themes rows, so
-- find_responses_missing_themes() kept returning them and the backfill
-- re-paid for the same extraction on every cycle. Record the outcome on the
-- response and exclude it from the picker.
ALTER TABLE public.prompt_responses
ADD COLUMN IF NOT EXISTS themes_none_found_at timestamptz;

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
      AND pr.themes_none_found_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.ai_themes t WHERE t.response_id = pr.id
      )
    ORDER BY pr.tested_at DESC
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.find_responses_missing_themes(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_responses_missing_themes(int, int) TO service_role;
