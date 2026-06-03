-- ============================================================================
-- Add the two theme MVs to refresh_company_metrics()
-- ============================================================================
-- refresh_company_metrics() is called by collect-company-responses after new
-- data lands (collection-driven, not cron). Append concurrent refreshes for
-- the new attribute-themes and response-sentiment MVs so they stay in sync
-- with the existing five company_*_mv views. Each refresh is wrapped so one
-- failure can't abort the others.

CREATE OR REPLACE FUNCTION public.refresh_company_metrics()
 RETURNS TABLE(view_name text, refresh_started timestamp with time zone, refresh_completed timestamp with time zone, success boolean, error_message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_error TEXT;
BEGIN
    -- Existing: sentiment scores
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_sentiment_scores_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_sentiment_scores_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_sentiment_scores_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- Existing: relevance scores
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_relevance_scores_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_relevance_scores_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_relevance_scores_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- Existing: top sources
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_top_sources_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_top_sources_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_top_sources_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- Existing: competitors
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_competitors_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_competitors_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_competitors_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- Existing: LLM rankings
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_llm_rankings_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_llm_rankings_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_llm_rankings_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- New: attribute themes (pre-aggregated attribute scores)
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_attribute_themes_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_attribute_themes_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_attribute_themes_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;

    -- New: per-response sentiment ratios
    v_start_time := NOW();
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY company_response_sentiment_mv;
        v_end_time := NOW();
        RETURN QUERY SELECT 'company_response_sentiment_mv'::TEXT, v_start_time, v_end_time, TRUE, NULL::TEXT;
    EXCEPTION WHEN OTHERS THEN
        v_end_time := NOW(); v_error := SQLERRM;
        RETURN QUERY SELECT 'company_response_sentiment_mv'::TEXT, v_start_time, v_end_time, FALSE, v_error;
    END;
END;
$function$;
