-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260603171348; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Distinct citation domains per company x month (the "unique domains" headline).
-- Separate MV because distinct-domain can't be summed across the job_function
-- grain of company_overview_stats_mv. Unnests citations (~1.15M rows globally);
-- refreshed only when new data lands, so the cost is monthly, not hourly.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_overview_domains_mv AS
SELECT
  pr.company_id,
  DATE_TRUNC('month', pr.tested_at)::date AS response_month,
  COUNT(DISTINCT cit.value->>'domain')    AS unique_domains
FROM public.prompt_responses pr
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(pr.citations) = 'array' THEN pr.citations ELSE '[]'::jsonb END
) AS cit(value)
WHERE pr.tested_at IS NOT NULL
  AND (cit.value->>'domain') IS NOT NULL
GROUP BY pr.company_id, DATE_TRUNC('month', pr.tested_at);

CREATE UNIQUE INDEX IF NOT EXISTS company_overview_domains_mv_uniq
  ON public.company_overview_domains_mv (company_id, response_month);

GRANT SELECT ON public.company_overview_domains_mv TO anon, authenticated, service_role;
