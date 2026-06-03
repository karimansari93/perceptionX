-- ============================================================================
-- Materialized View: Company Overview Domains (per company x month)
-- ============================================================================
-- Distinct citation domains per company per month (the "unique domains"
-- headline). Separate from company_overview_stats_mv because a distinct-domain
-- count can't be summed across that view's job_function grain. Unnests
-- citations (~1.15M rows globally); refreshed only when new data lands by
-- refresh_company_metrics(), so the cost is monthly, not hourly.
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
