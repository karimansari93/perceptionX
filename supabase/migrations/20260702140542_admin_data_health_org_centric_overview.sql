-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260702140542; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Org-centric health overview: one row per organization with real issue
-- counts (same issue definitions as admin_data_health_org, aggregated).
-- Return type changes, so drop the old thin version first.
DROP FUNCTION IF EXISTS public.admin_data_health_overview();

CREATE OR REPLACE FUNCTION public.admin_data_health_overview()
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  company_count bigint,
  completed_company_count bigint,
  collecting_company_count bigint,
  combo_count bigint,
  no_response_combos bigint,
  no_theme_combos bigint,
  mv_missing_combos bigint,
  stale_company_count bigint,
  latest_collected timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_loc_mv_fresh_at timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SET LOCAL statement_timeout = '120s';

  -- Oldest by-location MV refresh: a company collected after this can show
  -- null when filtered by location until the tick catches up.
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
  resp AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(pr.id) AS responses,
           count(pr.id) FILTER (WHERE cp.prompt_type IN ('sentiment','competitive')) AS sentiment_responses
    FROM public.confirmed_prompts cp
    JOIN public.prompt_responses pr ON pr.confirmed_prompt_id = cp.id
    GROUP BY 1, 2, 3
  ),
  th AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '') AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(t.id) AS themes
    FROM public.confirmed_prompts cp
    JOIN public.prompt_responses pr ON pr.confirmed_prompt_id = cp.id
    JOIN public.ai_themes t ON t.response_id = pr.id
    GROUP BY 1, 2, 3
  ),
  mv_loc AS (
    SELECT DISTINCT m.company_id, m.location_context AS loc
    FROM public.company_sentiment_scores_by_location_mv m
  ),
  combo_health AS (
    SELECT cb.company_id, cb.loc, cb.fn,
           (COALESCE(r.responses,0) = 0 AND cb.active_prompts > 0)                                        AS is_no_responses,
           (COALESCE(r.sentiment_responses,0) > 0 AND COALESCE(t.themes,0) = 0)                            AS is_no_themes,
           (COALESCE(r.sentiment_responses,0) > 0 AND COALESCE(t.themes,0) > 0 AND ml.loc IS NULL)         AS is_mv_missing
    FROM combos cb
    LEFT JOIN resp r  ON r.company_id = cb.company_id AND r.loc = cb.loc AND r.fn = cb.fn
    LEFT JOIN th t    ON t.company_id = cb.company_id AND t.loc = cb.loc AND t.fn = cb.fn
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
$$;
GRANT EXECUTE ON FUNCTION public.admin_data_health_overview() TO authenticated, service_role;
