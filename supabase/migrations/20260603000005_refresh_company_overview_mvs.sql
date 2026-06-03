-- ============================================================================
-- Add the overview MVs to refresh_company_metrics() (and tidy to a loop)
-- ============================================================================
-- refresh_company_metrics() is called by collect-company-responses after new
-- data lands. Add the two overview MVs and refactor the body to iterate a list
-- so future MVs are one array entry. Each refresh is wrapped so one failure
-- can't abort the rest.
CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
 RETURNS TABLE(view_name text, refresh_started timestamp with time zone, refresh_completed timestamp with time zone, success boolean, error_message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_error TEXT;
    v_views TEXT[] := ARRAY[
      'company_sentiment_scores_mv',
      'company_relevance_scores_mv',
      'company_top_sources_mv',
      'company_competitors_mv',
      'company_llm_rankings_mv',
      'company_attribute_themes_mv',
      'company_response_sentiment_mv',
      'company_overview_stats_mv',
      'company_overview_domains_mv'
    ];
    v_view TEXT;
BEGIN
    FOREACH v_view IN ARRAY v_views LOOP
        v_start_time := NOW();
        BEGIN
            EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_view);
            v_end_time := NOW();
            RETURN QUERY SELECT v_view, v_start_time, v_end_time, TRUE, NULL::TEXT;
        EXCEPTION WHEN OTHERS THEN
            v_end_time := NOW(); v_error := SQLERRM;
            RETURN QUERY SELECT v_view, v_start_time, v_end_time, FALSE, v_error;
        END;
    END LOOP;
END;
$function$;
