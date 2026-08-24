-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260608114710; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Wire the six by-location MVs into refresh_company_metrics() so they refresh
-- alongside the base company_*_mv views after new data lands.
CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
 RETURNS TABLE(view_name text, refresh_started timestamp with time zone, refresh_completed timestamp with time zone, success boolean, error_message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_error TEXT;
    v_mv TEXT;
BEGIN
    FOREACH v_mv IN ARRAY ARRAY[
        'company_sentiment_scores_mv',
        'company_relevance_scores_mv',
        'company_top_sources_mv',
        'company_competitors_mv',
        'company_llm_rankings_mv',
        'company_attribute_themes_mv',
        'company_response_sentiment_mv',
        'company_sentiment_scores_by_location_mv',
        'company_relevance_scores_by_location_mv',
        'company_attribute_themes_by_location_mv',
        'company_top_sources_by_location_mv',
        'company_competitors_by_location_mv',
        'company_llm_rankings_by_location_mv'
    ]
    LOOP
        v_start_time := NOW();
        BEGIN
            EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_mv);
            v_end_time := NOW();
            RETURN QUERY SELECT v_mv, v_start_time, v_end_time, TRUE, NULL::TEXT;
        EXCEPTION WHEN OTHERS THEN
            v_end_time := NOW(); v_error := SQLERRM;
            RETURN QUERY SELECT v_mv, v_start_time, v_end_time, FALSE, v_error;
        END;
    END LOOP;
END;
$function$;
