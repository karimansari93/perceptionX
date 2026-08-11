-- Make the admin health RPCs fit PostgREST's 8s statement timeout. Both were
-- 500ing in the browser: admin_data_health_overview measured 44 s and
-- get_analysis_health 32 s. Root causes, each verified with EXPLAIN ANALYZE:
--   * the overview joined prompts→responses as 40K random index probes
--     (322K buffers) instead of one pass, and counted all ~4M ai_themes rows
--     just to decide "has at least one theme" per combo;
--   * the readiness check seq-scanned ai_themes for max(created_at) (no
--     index existed), seq-scanned prompt_responses for a global
--     max(tested_at), and its missing-themes anti-join detoasted
--     response_text for every candidate row;
--   * ai_themes / prompt_responses had stale visibility maps from the
--     refresh-treadmill era, so "index-only" probes were secretly hitting
--     the 515 MB heap (VACUUM ANALYZE was run on both as part of this fix).
-- The in-function `SET LOCAL statement_timeout` trick does not help: the
-- outer statement's 8 s alarm is armed before the function body runs.
-- After: readiness ~1.1 s, overview ~1.8 s (authenticated, warm).

CREATE INDEX IF NOT EXISTS idx_ai_themes_created_at
  ON public.ai_themes (created_at DESC);

-- Cycle-scoped response lookups (count + last tested_at) ride one index.
DROP INDEX IF EXISTS public.idx_prompt_responses_collection_cycle;
CREATE INDEX IF NOT EXISTS idx_prompt_responses_cycle_tested
  ON public.prompt_responses (collection_cycle, tested_at DESC)
  WHERE collection_cycle IS NOT NULL;

-- Theme-candidate scan becomes index-only: the predicate (including the
-- length() check, which otherwise detoasts every large row) is baked in.
CREATE INDEX IF NOT EXISTS idx_pr_cycle_theme_candidates
  ON public.prompt_responses (collection_cycle)
  INCLUDE (id, company_id)
  WHERE response_text IS NOT NULL
    AND length(response_text) > 100
    AND COALESCE(for_index, false) = false
    AND COALESCE(company_mentioned, false) = true
    AND themes_none_found_at IS NULL;

-- Per-prompt response aggregation becomes one index-only pass.
CREATE INDEX IF NOT EXISTS idx_pr_prompt_include_id
  ON public.prompt_responses (confirmed_prompt_id) INCLUDE (id);

-- Overview: aggregate responses PER PROMPT first (index-only), join theme
-- presence via a hashed DISTINCT, then roll up to combos/orgs.
CREATE OR REPLACE FUNCTION public.admin_data_health_overview()
RETURNS TABLE(organization_id uuid, organization_name text, company_count bigint, completed_company_count bigint, collecting_company_count bigint, combo_count bigint, no_response_combos bigint, no_theme_combos bigint, mv_missing_combos bigint, stale_company_count bigint, latest_collected timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_loc_mv_fresh_at timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;

  SELECT min(last_refresh_finished) INTO v_loc_mv_fresh_at
  FROM public.mv_refresh_state WHERE mv_name LIKE '%by_location_mv';

  RETURN QUERY
  WITH combos AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(*) FILTER (WHERE cp.is_active) AS active_prompts
    FROM public.confirmed_prompts cp
    GROUP BY 1, 2, 3
  ),
  themed_responses AS MATERIALIZED (
    SELECT DISTINCT t.response_id FROM public.ai_themes t
  ),
  resp_by_prompt AS MATERIALIZED (
    SELECT pr.confirmed_prompt_id,
           count(*) AS responses,
           bool_or(tr.response_id IS NOT NULL) AS has_themes
    FROM public.prompt_responses pr
    LEFT JOIN themed_responses tr ON tr.response_id = pr.id
    GROUP BY 1
  ),
  resp AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           sum(r.responses) AS responses,
           sum(r.responses) FILTER (WHERE cp.prompt_type IN ('sentiment','competitive')) AS sentiment_responses,
           bool_or(r.has_themes) AS has_themes
    FROM public.confirmed_prompts cp
    JOIN resp_by_prompt r ON r.confirmed_prompt_id = cp.id
    GROUP BY 1, 2, 3
  ),
  mv_loc AS (
    SELECT DISTINCT m.company_id, m.location_context AS loc
    FROM public.company_sentiment_scores_by_location_mv m
  ),
  combo_health AS (
    SELECT cb.company_id, cb.loc, cb.fn,
           (COALESCE(r.responses,0) = 0 AND cb.active_prompts > 0)                                          AS is_no_responses,
           (COALESCE(r.sentiment_responses,0) > 0 AND NOT COALESCE(r.has_themes, false))                    AS is_no_themes,
           (COALESCE(r.sentiment_responses,0) > 0 AND COALESCE(r.has_themes, false) AND ml.loc IS NULL)     AS is_mv_missing
    FROM combos cb
    LEFT JOIN resp r  ON r.company_id = cb.company_id AND r.loc = cb.loc AND r.fn = cb.fn
    LEFT JOIN mv_loc ml ON ml.company_id = cb.company_id AND ml.loc = cb.loc
  )
  SELECT o.id,
         o.name,
         count(DISTINCT c.id),
         count(DISTINCT c.id) FILTER (WHERE c.data_collection_status = 'completed'),
         count(DISTINCT c.id) FILTER (WHERE c.data_collection_status IN ('collecting_search_insights','collecting_llm_data')),
         count(ch.company_id),
         count(*) FILTER (WHERE ch.is_no_responses),
         count(*) FILTER (WHERE ch.is_no_themes),
         count(*) FILTER (WHERE ch.is_mv_missing),
         count(DISTINCT c.id) FILTER (
           WHERE c.data_collection_completed_at IS NOT NULL
             AND v_loc_mv_fresh_at IS NOT NULL
             AND c.data_collection_completed_at > v_loc_mv_fresh_at),
         max(c.data_collection_completed_at)
  FROM public.organizations o
  LEFT JOIN public.organization_companies oc ON oc.organization_id = o.id
  LEFT JOIN public.companies c ON c.id = oc.company_id
  LEFT JOIN combo_health ch ON ch.company_id = c.id
  GROUP BY o.id, o.name
  ORDER BY o.name;
END;
$function$;

-- Readiness check with a deterministic plan: candidates come index-only from
-- the partial index; the small hot sentiment-MV index suppresses processed
-- rows first (MATERIALIZED pins the order — the planner had inverted it);
-- only true survivors probe the big theme index.
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
  v_missing bigint;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE insufficient_privilege USING MESSAGE = 'get_analysis_health is admin-only';
  END IF;

  SELECT max(collection_cycle) INTO v_latest_cycle FROM prompt_responses;

  WITH cand AS MATERIALIZED (
    SELECT pr.id, pr.company_id
    FROM prompt_responses pr
    WHERE pr.collection_cycle = v_latest_cycle
      AND pr.response_text IS NOT NULL AND length(pr.response_text) > 100
      AND COALESCE(pr.for_index, false) = false
      AND COALESCE(pr.company_mentioned, false) = true
      AND pr.themes_none_found_at IS NULL
  ), not_in_mv AS MATERIALIZED (
    SELECT c.id FROM cand c
    WHERE NOT EXISTS (
      SELECT 1 FROM company_response_sentiment_mv m
      WHERE m.company_id = c.company_id AND m.response_id = c.id)
  )
  SELECT count(*) INTO v_missing
  FROM not_in_mv c
  WHERE NOT EXISTS (SELECT 1 FROM ai_themes t WHERE t.response_id = c.id);

  SELECT jsonb_build_object(
    'generated_at', now(),
    'collection', jsonb_build_object(
      'active', public.collection_active(),
      'latest_cycle', v_latest_cycle,
      'responses_in_latest_cycle', (
        SELECT count(*) FROM prompt_responses WHERE collection_cycle = v_latest_cycle),
      'last_response_at', (
        SELECT max(tested_at) FROM prompt_responses WHERE collection_cycle = v_latest_cycle)
    ),
    'themes', jsonb_build_object(
      'latest_cycle_missing_for_mentioned', v_missing,
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

REVOKE ALL ON FUNCTION public.get_analysis_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analysis_health() TO authenticated, service_role;
