-- Two security-advisor regressions from 20260917120000_career_site.sql.
--
-- 1. _refresh_cm_career_site was left executable by anon and authenticated,
--    while every sibling (_refresh_cm_domain_stats, _refresh_cm_scope_stats,
--    …) is revoked from both. A rebuild is expensive and takes an advisory
--    lock, so an unauthenticated caller could have driven repeated full
--    career-site rebuilds through /rest/v1/rpc. The refresh pipeline calls it
--    as the table owner and does not need the grant.
--
-- 2. career_site_canonical_page and career_site_page_kind shipped without a
--    pinned search_path, the only two such functions in the database. They
--    are IMMUTABLE and called from inside SECURITY DEFINER reads, so an
--    attacker-controlled search_path is the classic shadowing vector; the
--    equivalents they sit beside (mcp_normalize_cited_url,
--    mcp_clean_cited_title) both pin it.

REVOKE ALL ON FUNCTION public._refresh_cm_career_site(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_cm_career_site(uuid) TO service_role;

ALTER FUNCTION public.career_site_canonical_page(text) SET search_path = public;
ALTER FUNCTION public.career_site_page_kind(text) SET search_path = public;
