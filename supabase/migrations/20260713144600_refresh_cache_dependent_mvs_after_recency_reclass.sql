-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713144600; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- MVs that directly read url_recency_cache.recency_score; refreshed after the reclassification.
-- The rankings_historical -> rankings_overview -> company_search_index chain references neither
-- the cache nor company_relevance_scores_by_location_mv, so it is intentionally NOT refreshed.
refresh materialized view public.company_relevance_scores_by_location_mv;
refresh materialized view public.competitor_benchmarks_mv;
refresh materialized view public.organization_recency_coverage_mv;

