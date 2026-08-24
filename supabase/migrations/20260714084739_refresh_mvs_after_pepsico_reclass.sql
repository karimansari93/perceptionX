-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260714084739; this file was
-- back-filled afterwards and therefore post-dates the deployment.

REFRESH MATERIALIZED VIEW company_relevance_scores_by_location_mv;
REFRESH MATERIALIZED VIEW rankings_overview;
REFRESH MATERIALIZED VIEW rankings_historical;
REFRESH MATERIALIZED VIEW company_search_index;
