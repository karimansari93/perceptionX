-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713144110; this file was
-- back-filled afterwards and therefore post-dates the deployment.

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
