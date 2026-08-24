-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260720085728; this file was
-- back-filled afterwards and therefore post-dates the deployment.

revoke select on public.company_sentiment_scores_by_location_mv from anon, public;
grant  select on public.company_sentiment_scores_by_location_mv to authenticated, service_role;

revoke select on public.company_visibility_by_location_mv from anon, public;
grant  select on public.company_visibility_by_location_mv to authenticated, service_role;

revoke select on public.company_search_index from anon, public;
grant  select on public.company_search_index to authenticated, service_role;

revoke select on public.rankings_overview from anon, public;
grant  select on public.rankings_overview to authenticated, service_role;

revoke select on public.rankings_historical from anon, public;
grant  select on public.rankings_historical to authenticated, service_role;

revoke select on public.firecrawl_dead_domains from anon, authenticated, public;
grant  select on public.firecrawl_dead_domains to service_role;
