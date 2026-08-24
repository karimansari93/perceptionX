-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260205161000; this file was
-- back-filled afterwards and therefore post-dates the deployment.

DROP VIEW IF EXISTS public.mv_rankings_scored
CREATE OR REPLACE VIEW public.mv_rankings_scored AS
WITH industry_totals AS (
  SELECT 
    industry, 
    country, 
    count(*) as total_combinations 
  FROM public.mv_industry_stats 
  GROUP BY industry, country
),
company_stats AS (
  SELECT 
    m.company_name,
    count(DISTINCT m.industry) as industry_count,
    array_agg(DISTINCT m.industry) as all_industries
  FROM public.mv_company_mentions m
  GROUP BY m.company_name
),
total_industries AS (
  SELECT count(DISTINCT industry) as total_count FROM public.mv_industry_stats
),
company_scores AS (
  SELECT 
    m.industry, 
    m.country, 
    m.company_name, 
    count(DISTINCT m.ai_model || '::' || m.theme) as company_combinations,
    array_agg(DISTINCT m.theme) as themes -- Also adding themes for Detail Modal
  FROM public.mv_company_mentions m
  GROUP BY m.industry, m.country, m.company_name
)
SELECT 
  c.company_name,
  c.industry,
  c.country,
  c.company_combinations,
  c.themes,
  cs.all_industries,
  t.total_combinations,
  -- Calculate Score: (Numerator / Denominator) * 100
  ROUND((c.company_combinations::numeric / NULLIF(t.total_combinations, 0)::numeric) * 100, 2) as visibility_score
FROM company_scores c
JOIN industry_totals t ON c.industry = t.industry AND c.country = t.country
LEFT JOIN public.known_sources ks ON lower(trim(c.company_name)) = ks.name
LEFT JOIN company_stats cs ON c.company_name = cs.company_name
CROSS JOIN total_industries ti
WHERE 
  ks.name IS NULL -- Exclude known sources
  AND (cs.industry_count::float / NULLIF(ti.total_count, 0)::float) <= 0.5 -- Exclude companies present in >50% industries
  AND c.company_name !~* '^(recruiting|staffing|job board|career site)'
GRANT SELECT ON public.mv_rankings_scored TO anon, authenticated, service_role
