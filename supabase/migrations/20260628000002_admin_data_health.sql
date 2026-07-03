-- ============================================================================
-- Admin "Data Health" backend
-- ============================================================================
--
-- Surfaces, for every organization -> company -> location -> function, the gaps
-- that cause null data on the dashboard:
--   * MV staleness        -- a rollup MV is behind the latest data change
--   * mv_missing          -- a (company, location) has sentiment/competitive
--                            themes but is ABSENT from the by-location MV
--                            (the exact Ford Energy Kentucky/Michigan symptom)
--   * no_responses        -- active prompts exist but nothing was collected
--   * no_themes           -- sentiment/competitive responses exist but were
--                            never theme-analysed
--
-- All functions are admin-gated and SECURITY DEFINER. They raise their own
-- statement_timeout (the `authenticated` role caps at 8s, and the per-org
-- theme scan can exceed that) via SET LOCAL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. MV refresh status (cheap) -- drives the global staleness banner + the
--    "Refresh metrics" button state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_mv_refresh_status()
RETURNS TABLE(
  mv_name               text,
  last_refresh_finished timestamptz,
  last_status           text,
  last_error            text,
  last_duration_ms      integer,
  row_count             bigint,
  is_stale              boolean,
  force_refresh         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_watermark timestamptz;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT data_changed_at INTO v_watermark FROM public.mv_refresh_watermark WHERE id;

  RETURN QUERY
  SELECT s.mv_name,
         s.last_refresh_finished,
         s.last_status,
         s.last_error,
         s.last_duration_ms,
         s.row_count,
         (s.last_refresh_finished IS NULL
            OR (v_watermark IS NOT NULL AND s.last_refresh_finished < v_watermark)) AS is_stale,
         s.force_refresh
  FROM public.mv_refresh_state s
  ORDER BY s.mv_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mv_refresh_status() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Org-centric overview: one row per organization with aggregated issue
--    counts across every (company, location, function) combo — the same issue
--    definitions as the drilldown below. The platform is small enough
--    (~11 orgs / ~370 combos) that the full scan runs comfortably here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_health_overview()
RETURNS TABLE(
  organization_id          uuid,
  organization_name        text,
  company_count            bigint,
  completed_company_count  bigint,
  collecting_company_count bigint,
  combo_count              bigint,
  no_response_combos       bigint,
  no_theme_combos          bigint,
  mv_missing_combos        bigint,
  stale_company_count      bigint,
  latest_collected         timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_loc_mv_fresh_at timestamptz;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SET LOCAL statement_timeout = '120s';

  -- Oldest by-location MV refresh: any company collected after this may show
  -- null when filtered by location (the recurring bug's fingerprint).
  SELECT min(last_refresh_finished) INTO v_loc_mv_fresh_at
  FROM public.mv_refresh_state
  WHERE mv_name LIKE '%by_location_mv';

  RETURN QUERY
  WITH combos AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(*) FILTER (WHERE cp.is_active) AS active_prompts
    FROM public.confirmed_prompts cp
    GROUP BY 1, 2, 3
  ),
  resp AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(pr.id) AS responses,
           count(pr.id) FILTER (WHERE cp.prompt_type IN ('sentiment','competitive')) AS sentiment_responses
    FROM public.confirmed_prompts cp
    JOIN public.prompt_responses pr ON pr.confirmed_prompt_id = cp.id
    GROUP BY 1, 2, 3
  ),
  th AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS loc,
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
    SELECT cb.company_id,
           (COALESCE(r.responses,0) = 0 AND cb.active_prompts > 0)                                AS is_no_responses,
           (COALESCE(r.sentiment_responses,0) > 0 AND COALESCE(t.themes,0) = 0)                    AS is_no_themes,
           (COALESCE(r.sentiment_responses,0) > 0 AND COALESCE(t.themes,0) > 0 AND ml.loc IS NULL) AS is_mv_missing
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

-- ---------------------------------------------------------------------------
-- 3. Per-org drilldown: one row per (company, location, function) with counts
--    and an issues[] array. Bounded to a single org, so the theme scan is
--    cheap. location/function are normalised the same way the by-location MVs
--    normalise them (btrim, blank -> '') so MV presence joins correctly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_health_org(p_org uuid)
RETURNS TABLE(
  company_id           uuid,
  company_name         text,
  country              text,
  location_context     text,
  job_function_context text,
  prompts              bigint,
  active_prompts       bigint,
  responses            bigint,
  sentiment_responses  bigint,
  themes               bigint,
  mv_present           boolean,
  issues               text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SET LOCAL statement_timeout = '60s';

  RETURN QUERY
  WITH org_co AS (
    SELECT c.id, c.name, c.country
    FROM public.organization_companies oc
    JOIN public.companies c ON c.id = oc.company_id
    WHERE oc.organization_id = p_org
  ),
  -- One row per (company, normalised location, normalised function) from prompts.
  combos AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(*)                          AS prompts,
           count(*) FILTER (WHERE cp.is_active) AS active_prompts
    FROM public.confirmed_prompts cp
    WHERE cp.company_id IN (SELECT id FROM org_co)
    GROUP BY 1, 2, 3
  ),
  resp AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(DISTINCT pr.id) AS responses,
           count(DISTINCT pr.id) FILTER (WHERE cp.prompt_type IN ('sentiment','competitive')) AS sentiment_responses
    FROM public.confirmed_prompts cp
    JOIN public.prompt_responses pr ON pr.confirmed_prompt_id = cp.id
    WHERE cp.company_id IN (SELECT id FROM org_co)
    GROUP BY 1, 2, 3
  ),
  th AS (
    SELECT cp.company_id,
           COALESCE(NULLIF(btrim(cp.location_context), ''), '')     AS loc,
           COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS fn,
           count(t.id) AS themes
    FROM public.confirmed_prompts cp
    JOIN public.prompt_responses pr ON pr.confirmed_prompt_id = cp.id
    JOIN public.ai_themes t ON t.response_id = pr.id
    WHERE cp.company_id IN (SELECT id FROM org_co)
    GROUP BY 1, 2, 3
  ),
  -- (company, location) buckets present in the by-location sentiment MV.
  mv_loc AS (
    SELECT DISTINCT m.company_id, m.location_context AS loc
    FROM public.company_sentiment_scores_by_location_mv m
    WHERE m.company_id IN (SELECT id FROM org_co)
  )
  SELECT
    oc.id,
    oc.name,
    oc.country,
    cb.loc,
    cb.fn,
    cb.prompts,
    cb.active_prompts,
    COALESCE(r.responses, 0),
    COALESCE(r.sentiment_responses, 0),
    COALESCE(t.themes, 0),
    (ml.loc IS NOT NULL) AS mv_present,
    (
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(r.responses, 0) = 0 AND cb.active_prompts > 0 THEN 'no_responses' END,
        CASE WHEN COALESCE(r.sentiment_responses, 0) > 0 AND COALESCE(t.themes, 0) = 0 THEN 'no_themes' END,
        CASE WHEN COALESCE(r.sentiment_responses, 0) > 0 AND COALESCE(t.themes, 0) > 0 AND ml.loc IS NULL THEN 'mv_missing' END
      ], NULL)
    ) AS issues
  FROM combos cb
  JOIN org_co oc ON oc.id = cb.company_id
  LEFT JOIN resp r  ON r.company_id = cb.company_id AND r.loc = cb.loc AND r.fn = cb.fn
  LEFT JOIN th t    ON t.company_id = cb.company_id AND t.loc = cb.loc AND t.fn = cb.fn
  LEFT JOIN mv_loc ml ON ml.company_id = cb.company_id AND ml.loc = cb.loc
  ORDER BY oc.name, cb.loc, cb.fn;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_data_health_org(uuid) TO authenticated, service_role;
