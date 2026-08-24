-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811104104; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Overview: aggregate responses PER PROMPT first over the covering
-- (confirmed_prompt_id) INCLUDE (id) index — one index-only pass — instead of
-- the 40K random heap probes the prompt→response nested loop was doing
-- (measured 38 s). Theme presence joins the same pre-aggregate via a hashed
-- DISTINCT over the theme response ids.
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
