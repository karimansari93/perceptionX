-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811095102; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Health-check theme coverage is scoped to the LATEST collection cycle — the
-- question after a collection is "are this cycle's themes done", and the
-- cycle index bounds the anti-join to that cycle's rows. (The all-time
-- backlog stays reachable via find_responses_missing_themes tooling.)

CREATE OR REPLACE FUNCTION public.get_analysis_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_latest_cycle date;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_analysis_health is admin-only';
  END IF;

  SELECT max(collection_cycle) INTO v_latest_cycle FROM prompt_responses;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'collection', jsonb_build_object(
      'active', public.collection_active(),
      'latest_cycle', v_latest_cycle,
      'responses_in_latest_cycle', (
        SELECT count(*) FROM prompt_responses WHERE collection_cycle = v_latest_cycle),
      'last_response_at', (SELECT max(tested_at) FROM prompt_responses)
    ),
    'themes', jsonb_build_object(
      'latest_cycle_missing_for_mentioned', (
        SELECT count(*) FROM prompt_responses pr
        WHERE pr.collection_cycle = v_latest_cycle
          AND pr.response_text IS NOT NULL AND length(pr.response_text) > 100
          AND COALESCE(pr.for_index, false) = false
          AND COALESCE(pr.company_mentioned, false) = true
          AND pr.themes_none_found_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = pr.id)),
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
