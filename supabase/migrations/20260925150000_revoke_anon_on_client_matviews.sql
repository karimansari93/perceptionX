-- ============================================================================
-- Remove logged-out (anon) access to client-data matviews
-- ============================================================================
-- Matviews can't carry RLS, and these were granted to anon, so anyone holding
-- the public anon key (it ships in the web bundle) could read every client's
-- by-location visibility, sentiment, sources, competitors, themes, benchmark
-- and recency URL rollups. Verified 2026-09-25 with a plain anon REST call.
-- 24h of edge logs showed no legitimate anon reads of these views: the public
-- Index reads rankings_overview / rankings_historical / company_search_index
-- and RPCs, which are deliberately left public here.
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'company_attribute_themes_by_location_mv',
    'company_competitors_by_location_mv',
    'company_llm_rankings_by_location_mv',
    'company_relevance_scores_by_location_mv',
    'company_sentiment_scores_by_location_mv',
    'company_sentiment_scores_by_location_mv_v2tmp',
    'company_top_sources_by_location_mv',
    'company_visibility_by_location_mv',
    'competitor_benchmarks_mv',
    'organization_company_source_urls_mv',
    'organization_recency_coverage_mv',
    'organization_source_urls_mv',
    'firecrawl_dead_domains'
  ] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    END IF;
  END LOOP;
END;
$$;
