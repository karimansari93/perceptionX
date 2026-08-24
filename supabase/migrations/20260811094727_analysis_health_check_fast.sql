-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811094727; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- The health check must answer in seconds: bound the missing-themes count at
-- 10,000 (the real number after a collection is a few hundred to a few
-- thousand; 10,000+ just means "not done") and index collection_cycle so the
-- latest-cycle count doesn't seq-scan 400 MB.

CREATE INDEX IF NOT EXISTS idx_prompt_responses_collection_cycle
  ON public.prompt_responses (collection_cycle)
  WHERE collection_cycle IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_analysis_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_analysis_health is admin-only';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'collection', jsonb_build_object(
      'active', public.collection_active(),
      'latest_cycle', (SELECT max(collection_cycle) FROM prompt_responses),
      'responses_in_latest_cycle', (
        SELECT count(*) FROM prompt_responses
        WHERE collection_cycle = (SELECT max(collection_cycle) FROM prompt_responses)),
      'last_response_at', (SELECT max(tested_at) FROM prompt_responses)
    ),
    'themes', jsonb_build_object(
      -- Bounded at 10,000: exact below the cap, "at least 10000" above it.
      'missing_for_mentioned_responses', (
        SELECT count(*) FROM (
          SELECT 1 FROM prompt_responses pr
          WHERE pr.response_text IS NOT NULL AND length(pr.response_text) > 100
            AND COALESCE(pr.for_index, false) = false
            AND COALESCE(pr.company_mentioned, false) = true
            AND pr.themes_none_found_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = pr.id)
          LIMIT 10000
        ) bounded),
      'last_theme_created_at', (SELECT max(created_at) FROM ai_themes),
      'edge_invocation_failures_24h', (
        SELECT count(*) FROM net._http_response
        WHERE created > now() - interval '24 hours' AND error_msg IS NOT NULL)
    ),
    'entity_suggestions', jsonb_build_object(
      'pending', (SELECT count(*) FROM entity_alias_suggestions WHERE status = 'pending'),
      'approved', (SELECT count(*) FROM entity_alias_suggestions WHERE status = 'approved')
    ),
    'rollups', jsonb_build_object(
      'companies_awaiting_refresh', (SELECT count(*) FROM company_metrics_dirty),
      'company_rollups_refreshed_at', (
        SELECT min(last_refresh_finished) FROM mv_refresh_state
        WHERE mv_name NOT LIKE '%\_by\_location\_mv' ESCAPE '\'),
      'by_location_oldest_refresh', (
        SELECT min(last_refresh_finished) FROM mv_refresh_state
        WHERE mv_name LIKE '%\_by\_location\_mv' ESCAPE '\'),
      'by_location_views_stale_6h', (
        SELECT count(*) FROM mv_refresh_state
        WHERE mv_name LIKE '%\_by\_location\_mv' ESCAPE '\'
          AND (last_refresh_finished IS NULL OR last_refresh_finished < now() - interval '6 hours')),
      'last_refresh_errors', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('mv', mv_name, 'error', last_error)), '[]'::jsonb)
        FROM mv_refresh_state WHERE last_status = 'error')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
