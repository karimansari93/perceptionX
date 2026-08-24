-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260225065716; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- rankings_overview and rankings_historical are public leaderboard views
-- queried directly by the frontend -- restore access for authenticated users.
-- anon stays revoked (Bingbot was hitting these unauthenticated, which is undesirable).
GRANT SELECT ON public.rankings_overview TO authenticated;
GRANT SELECT ON public.rankings_historical TO authenticated;

