-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260520125644; this file was
-- back-filled afterwards and therefore post-dates the deployment.

DROP MATERIALIZED VIEW IF EXISTS public.company_search_index;

CREATE MATERIALIZED VIEW public.company_search_index AS
 WITH best AS (
   SELECT DISTINCT ON (rankings_overview.canonical_name)
          rankings_overview.canonical_name,
          rankings_overview.industry_context AS best_industry
     FROM rankings_overview
    ORDER BY rankings_overview.canonical_name, rankings_overview.score_all DESC
 )
 SELECT ro.canonical_name,
        max(ro.website_domain)                                            AS website_domain,
        array_agg(DISTINCT ro.industry_context ORDER BY ro.industry_context) AS industries,
        sum(ro.mention_count)::integer                                    AS total_mentions,
        b.best_industry
   FROM rankings_overview ro
   JOIN best b
     ON ro.canonical_name = b.canonical_name
   LEFT JOIN company_overrides co
     ON lower(co.canonical_name) = lower(ro.canonical_name)
  WHERE length(TRIM(BOTH FROM ro.canonical_name)) > 0
    AND (co.status IS NULL OR co.status <> 'excluded')
  GROUP BY ro.canonical_name, b.best_industry;

CREATE UNIQUE INDEX company_search_index_uk
  ON public.company_search_index (canonical_name);

GRANT SELECT ON public.company_search_index TO anon, authenticated, service_role;
