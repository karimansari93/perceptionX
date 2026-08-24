-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260603171321; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Per company x month x job_function aggregates that power the Overview's
-- headline numbers (response count, visibility, citation total) so the Overview
-- no longer needs to download raw prompt_responses on load. Cheap: counts +
-- a sum of citation array lengths, no unnest. 1:1 join to confirmed_prompts
-- (one prompt per response) so no fan-out.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_overview_stats_mv AS
SELECT
  pr.company_id,
  DATE_TRUNC('month', pr.tested_at)::date              AS response_month,
  COALESCE(NULLIF(btrim(cp.job_function_context), ''), '') AS job_function_context,
  COUNT(*)                                             AS response_count,
  COUNT(*) FILTER (WHERE pr.company_mentioned)         AS mentioned_count,
  COALESCE(SUM(CASE WHEN jsonb_typeof(pr.citations) = 'array'
                    THEN jsonb_array_length(pr.citations) ELSE 0 END), 0) AS total_citations
FROM public.prompt_responses pr
JOIN public.confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE pr.tested_at IS NOT NULL
GROUP BY pr.company_id, DATE_TRUNC('month', pr.tested_at),
         COALESCE(NULLIF(btrim(cp.job_function_context), ''), '');

CREATE UNIQUE INDEX IF NOT EXISTS company_overview_stats_mv_uniq
  ON public.company_overview_stats_mv (company_id, response_month, job_function_context);
CREATE INDEX IF NOT EXISTS company_overview_stats_mv_company_idx
  ON public.company_overview_stats_mv (company_id);

GRANT SELECT ON public.company_overview_stats_mv TO anon, authenticated, service_role;
