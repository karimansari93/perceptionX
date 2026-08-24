-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817153532; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Amend find_responses_missing_themes: exclude rows already marked as themed
-- (themes_found_at is stamped by trigger ai_themes_stamp_found + backfill).
-- The NOT EXISTS stays as belt-and-braces; with the marker predicate it is
-- only evaluated for genuinely-unprocessed rows, so it becomes cheap.
CREATE OR REPLACE FUNCTION public.find_responses_missing_themes(p_limit integer DEFAULT 100, p_days integer DEFAULT 90)
 RETURNS TABLE(id uuid, company_id uuid, response_text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
    WITH candidates AS (
        SELECT p.id, p.company_id, p.tested_at
        FROM public.prompt_responses p
        WHERE p.tested_at >= now() - (p_days || ' days')::interval
          AND p.response_text IS NOT NULL
          AND length(p.response_text) > 100
          AND COALESCE(p.for_index, false) = false
          AND COALESCE(p.company_mentioned, false) = true
          AND p.themes_none_found_at IS NULL
          AND p.themes_found_at IS NULL
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
$function$;
