-- Close cross-client reads by logged-in users.
--
-- Materialized views have no RLS, so a SELECT grant to `authenticated` let any
-- signed-in client read every other client's rollups. The dashboard never
-- reads these directly; it goes through get_dashboard_rollups /
-- get_location_rollups, which filter via accessible_company_ids().

-- 1. Per-location dashboard rollups: service/definer access only.
REVOKE SELECT ON
  public.company_attribute_themes_by_location_mv,
  public.company_competitors_by_location_mv,
  public.company_llm_rankings_by_location_mv,
  public.company_relevance_scores_by_location_mv,
  public.company_sentiment_scores_by_location_mv,
  public.company_sentiment_scores_by_location_mv_v2tmp,
  public.company_top_sources_by_location_mv,
  public.company_visibility_by_location_mv
FROM PUBLIC, anon, authenticated;

-- 2. Recency coverage (admin Recency tab + process-recency-rescore-tick).
-- Who may read the recency views: platform admins, the service role (edge
-- functions), and database-side jobs (pg_cron runs as postgres).
CREATE OR REPLACE FUNCTION public.can_read_recency_admin_views()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_admin()
      OR COALESCE(auth.role(), '') = 'service_role'
      OR current_user IN ('postgres', 'service_role', 'supabase_admin');
$$;

-- The URL status views become owner-privileged (so they no longer need
-- grants on the matviews beneath) and filter to those callers.
CREATE OR REPLACE VIEW public.v_company_url_status
WITH (security_invoker = false) AS
SELECT csu.organization_id, csu.company_id, csu.url,
       urc.recency_score, urc.extraction_method, urc.publication_date, urc.last_checked_at
FROM public.organization_company_source_urls_mv csu
LEFT JOIN public.url_recency_cache urc ON urc.url = csu.url
WHERE (SELECT public.can_read_recency_admin_views());

CREATE OR REPLACE VIEW public.v_organization_url_status
WITH (security_invoker = false) AS
SELECT osu.organization_id, osu.url,
       urc.recency_score, urc.extraction_method, urc.publication_date, urc.last_checked_at
FROM public.organization_source_urls_mv osu
LEFT JOIN public.url_recency_cache urc ON urc.url = osu.url
WHERE (SELECT public.can_read_recency_admin_views());

-- The coverage matview is read by name from the admin tab, so it moves to
-- organization_recency_coverage_data and a filtered view takes its name.
ALTER MATERIALIZED VIEW public.organization_recency_coverage_mv
  RENAME TO organization_recency_coverage_data;

CREATE VIEW public.organization_recency_coverage_mv
WITH (security_invoker = false) AS
SELECT * FROM public.organization_recency_coverage_data
WHERE (SELECT public.can_read_recency_admin_views());

GRANT SELECT ON public.organization_recency_coverage_mv TO authenticated, service_role;

REVOKE SELECT ON
  public.organization_company_source_urls_mv,
  public.organization_source_urls_mv,
  public.organization_recency_coverage_data
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_organization_recency_coverage()
 RETURNS TABLE(view_name text, refresh_started timestamp with time zone, refresh_completed timestamp with time zone, success boolean, error_message text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_err TEXT;
BEGIN
  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_company_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_company_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_company_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_recency_coverage_data;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_recency_coverage_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_recency_coverage_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;
END;
$function$;

-- 3. Admin actions that ran for any signed-in user.
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_guard text := E'BEGIN\n  IF NOT (public.is_admin() OR COALESCE(auth.role(), '''') = ''service_role'') THEN\n    RAISE insufficient_privilege USING MESSAGE = ''admin-only'';\n  END IF;\n';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['enqueue_recency_rescore', 'refresh_company_competitors_mv'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn;
    IF strpos(v_def, 'admin-only') > 0 THEN CONTINUE; END IF;
    -- Guard goes right after the body's first BEGIN (after DECLARE).
    v_def := regexp_replace(v_def, E'\\mBEGIN\\M\\s*\\n', v_guard);
    EXECUTE v_def;
  END LOOP;
END $$;

-- 4. Internal functions that signed-out (and signed-in) callers could run.
REVOKE EXECUTE ON FUNCTION public._refresh_cm_career_domains(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._refresh_cm_career_passages(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._refresh_cm_career_topic_stats(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_unmapped_competitor_variants(integer, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_unmapped_competitor_variants(integer, uuid, uuid, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_latest_collection_start(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_company_readiness(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_recency_coverage_refresh_state() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_recency_coverage_refresh() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
