-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260206134610; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Update rankings_overview to include country and filter for US/UK only

DROP MATERIALIZED VIEW IF EXISTS public.rankings_overview CASCADE;

CREATE MATERIALIZED VIEW public.rankings_overview AS
WITH raw_data AS (
  SELECT 
    pr.ai_model,
    cp.industry_context,
    cp.location_context AS country,
    cp.prompt_theme,
    pr.detected_competitors
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE pr.for_index = true 
    AND cp.industry_context IS NOT NULL
    AND (
      cp.location_context = 'United States' 
      OR cp.location_context = 'United Kingdom'
    )
), 
industry_stats AS (
  SELECT 
    raw_data.industry_context,
    raw_data.country,
    array_agg(DISTINCT (raw_data.ai_model || '::' || COALESCE(raw_data.prompt_theme, 'null'))) AS all_industry_combinations
  FROM raw_data
  GROUP BY raw_data.industry_context, raw_data.country
), 
raw_split AS (
  SELECT 
    rd.ai_model,
    rd.industry_context,
    rd.country,
    rd.prompt_theme,
    clean_company_name(token) AS company_name
  FROM raw_data rd
  CROSS JOIN LATERAL regexp_split_to_table(rd.detected_competitors, '[,;\n]+') AS token
  WHERE length(TRIM(BOTH FROM token)) > 1
), 
company_stats AS (
  SELECT 
    raw_split.industry_context,
    raw_split.country,
    raw_split.company_name,
    count(*) AS mention_count,
    array_agg(DISTINCT (raw_split.ai_model || '::' || COALESCE(raw_split.prompt_theme, 'null'))) AS combinations
  FROM raw_split
  GROUP BY raw_split.industry_context, raw_split.country, raw_split.company_name
)
SELECT 
  cs.company_name,
  cs.industry_context,
  cs.country,
  cs.mention_count,
  cs.combinations,
  ist.all_industry_combinations
FROM company_stats cs
JOIN industry_stats ist ON cs.industry_context = ist.industry_context AND cs.country = ist.country;

-- Create indexes for performance
CREATE INDEX idx_rankings_overview_industry ON public.rankings_overview(industry_context);
CREATE INDEX idx_rankings_overview_country ON public.rankings_overview(country);
CREATE INDEX idx_rankings_overview_composite ON public.rankings_overview(industry_context, country);

-- Grant permissions
GRANT SELECT ON public.rankings_overview TO anon, authenticated, service_role;

