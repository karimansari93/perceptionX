-- The page cube's FULL rebuild (all 188 companies, ~1M page rows in one
-- transaction) coincided with a Postgres restart on this instance
-- (postmaster restart 14:44 UTC, 4 minutes into the run; 256 MB shared
-- buffers, 3.5 MB work_mem). Per-company refreshes are small (Ford's
-- largest profile: 8 s) and are the path the pipeline uses after every
-- collection, so the cube stays registered for per-company refresh and
-- dispatch but leaves the hourly full-rebuild list. Backfills for
-- existing companies are run per company, in batches.

CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS TABLE(view_name text, refresh_started timestamptz, refresh_completed timestamptz, success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mv    text;
  v_start timestamptz;
BEGIN
  FOREACH v_mv IN ARRAY ARRAY[
    'company_sentiment_scores_mv','company_relevance_scores_mv','company_top_sources_mv',
    'company_competitors_mv','company_llm_rankings_mv','company_attribute_themes_mv',
    'company_response_sentiment_mv',
    'company_scope_stats_mv','company_scope_daily_stats_mv',
    'company_scope_prompt_type_stats_mv','company_llm_stats_mv','company_domain_stats_mv',
    'company_competitor_stats_mv',
    'company_sentiment_scores_by_location_mv','company_relevance_scores_by_location_mv',
    'company_attribute_themes_by_location_mv','company_top_sources_by_location_mv',
    'company_competitors_by_location_mv','company_llm_rankings_by_location_mv'
  ] LOOP
    v_start := now();
    BEGIN
      PERFORM public._refresh_cm_dispatch(v_mv);
      RETURN QUERY SELECT v_mv, v_start, now(), TRUE, NULL::text;
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT v_mv, v_start, now(), FALSE, SQLERRM;
    END;
  END LOOP;
END $$;
