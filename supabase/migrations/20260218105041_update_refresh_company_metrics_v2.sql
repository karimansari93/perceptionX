-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218105041; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
RETURNS TABLE(view_name text, refresh_started timestamptz, refresh_completed timestamptz, success boolean, error_message text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_error TEXT;
  v_mv TEXT;
  mv_list TEXT[] := ARRAY[
    'company_sentiment_scores_mv',
    'company_relevance_scores_mv',
    'company_overview_metrics_mv',
    'company_top_sources_mv',
    'company_competitors_mv',
    'company_llm_rankings_mv'
  ];
BEGIN
  FOREACH v_mv IN ARRAY mv_list LOOP
    v_start_time := NOW();
    BEGIN
      EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || v_mv;
      v_end_time := NOW();
      RETURN QUERY SELECT v_mv, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
      v_end_time := NOW();
      v_error := SQLERRM;
      RETURN QUERY SELECT v_mv, v_start_time, v_end_time, FALSE, v_error;
    END;
  END LOOP;
END;
$function$;

