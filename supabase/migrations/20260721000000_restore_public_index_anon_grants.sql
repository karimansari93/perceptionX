-- Restore anon read access to the public Employer Visibility Index surface.
--
-- 20260720085728_lock_down_public_materialized_views revoked SELECT from
-- anon on rankings_overview, rankings_historical and company_search_index.
-- Those three matviews are the data source for the public site
-- employers.perceptionx.ai: the SPA queries them over PostgREST with the
-- anon key, so the revoke made every rankings / company-profile / search
-- request fail with 401 "permission denied for materialized view"
-- (SECURITY INVOKER RPCs such as get_canonical_name_from_slug fail the
-- same way). The /api edge function survived only because the api_*
-- functions are SECURITY DEFINER.
--
-- This is the third round of this revoke/restore cycle (20260218070242 ->
-- 20260219142612, and 20260707162411 -> 20260711071724). These views expose
-- only published aggregate rankings data and are public by design; the
-- Supabase "materialized view in API" lint on them is an accepted
-- trade-off. Do not "fix" that lint by revoking anon SELECT again.
--
-- Applied to production 2026-07-21 as versions 20260721092405
-- (restore_public_index_anon_grants) and 20260721092535
-- (restore_anon_grants_on_public_index_relations, a concurrent duplicate of
-- the same GRANT from a second session — harmless, kept for history).

GRANT SELECT ON public.rankings_overview,
                public.rankings_historical,
                public.company_search_index
TO anon, authenticated;

-- Keep the read-only posture from 20260711071724: API roles get SELECT only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.rankings_overview,
     public.rankings_historical,
     public.company_search_index
  FROM anon, authenticated;

-- Durable in-database markers so the next security sweep sees the
-- constraint at the object it is about to lock down.
COMMENT ON MATERIALIZED VIEW public.rankings_overview IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
COMMENT ON MATERIALIZED VIEW public.rankings_historical IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by employers.perceptionx.ai. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
COMMENT ON MATERIALIZED VIEW public.company_search_index IS
  'PUBLIC BY DESIGN: read anonymously (anon SELECT via PostgREST) by the employers.perceptionx.ai company search. Revoking anon SELECT breaks the public site with 401s - see 20260721000000_restore_public_index_anon_grants.';
