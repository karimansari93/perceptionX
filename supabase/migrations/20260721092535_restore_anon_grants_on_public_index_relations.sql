-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260721092535; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- The companion public rankings app reads these relations with the anon key.
-- 20260720085728 (lock_down_public_materialized_views) revoked anon SELECT and
-- broke it — the same breakage 20260707162411 caused and 20260711071724
-- (restore_public_index_grants) fixed. Restore anon read access; everything
-- else from the 2026-07-20 hardening stays locked down.
-- NOTE for future hardening passes: rankings_overview, rankings_historical and
-- company_search_index are intentionally anon-readable; do not revoke again
-- without coordinating with the other app.
GRANT SELECT ON public.rankings_overview, public.rankings_historical, public.company_search_index TO anon;
