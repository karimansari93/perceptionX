-- Dashboard RPC working memory (reliability audit P0-2 / G.11).
--
-- pg_stat_database on 2026-09-11 showed 6,208 temp files and 59 GB spilled to
-- disk with the cluster work_mem at 3.5 MB. The composite dashboard RPCs sort
-- and hash-aggregate multi-hundred-MB matviews on every cold load; with
-- 3.5 MB those steps spill, and under a cold-load burst they are what crosses
-- the 8 s `authenticated` statement timeout.
--
-- A function-level setting applies only while one of these functions runs,
-- so the cluster default (and every other workload) is untouched. 16 MB is
-- sized for the current 1 GB instance (ten concurrent calls = 160 MB worst
-- case); raise to 32 MB once the compute upgrade lands.
--
-- Additive and reversible: `ALTER FUNCTION ... RESET work_mem`.

ALTER FUNCTION public.get_dashboard_rollups(uuid[]) SET work_mem = '16MB';
ALTER FUNCTION public.get_scope_stats(uuid[]) SET work_mem = '16MB';
ALTER FUNCTION public.get_location_rollups(uuid[], text[], uuid[], text[]) SET work_mem = '16MB';
ALTER FUNCTION public.get_domain_stats(uuid[], text[], uuid[], text[], date[], text[], boolean, integer) SET work_mem = '16MB';
ALTER FUNCTION public.get_competitor_stats(uuid[], text[], uuid[], text[], date[], integer) SET work_mem = '16MB';
ALTER FUNCTION public.get_company_responses_page(uuid, text[], timestamptz, timestamptz, uuid, integer) SET work_mem = '16MB';
