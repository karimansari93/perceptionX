-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260206133447; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Update materialized views to only include US and UK data

DROP MATERIALIZED VIEW IF EXISTS public.mv_company_mentions CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_industry_stats CASCADE;

-- Recreate mv_company_mentions with US/UK filter
CREATE MATERIALIZED VIEW public.mv_company_mentions AS
WITH raw_data AS (
  SELECT
    pr.id AS response_id,
    pr.ai_model,
    cp.industry_context AS industry,
    cp.location_context AS country,
    cp.prompt_theme AS theme,
    pr.detected_competitors
  FROM
    public.prompt_responses pr
  JOIN
    public.confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE
    pr.for_index = true
    AND cp.industry_context IS NOT NULL
    AND (
      cp.location_context = 'United States' 
      OR cp.location_context = 'United Kingdom'
    )
),
split_data AS (
  SELECT
    industry,
    country,
    ai_model,
    theme,
    regexp_split_to_table(detected_competitors, '[,;\n]') AS raw_company_name
  FROM
    raw_data
  WHERE
    detected_competitors IS NOT NULL 
    AND length(trim(detected_competitors)) > 0
)
SELECT
  industry,
  country,
  normalize_company_name(TRIM(BOTH ' "' FROM TRIM(raw_company_name))) AS company_name,
  ai_model,
  theme,
  COUNT(*) as mention_count
FROM
  split_data
WHERE
  length(TRIM(BOTH ' "' FROM TRIM(raw_company_name))) >= 2
GROUP BY
  industry,
  country,
  normalize_company_name(TRIM(BOTH ' "' FROM TRIM(raw_company_name))),
  ai_model,
  theme;

CREATE INDEX idx_mv_company_mentions_industry ON public.mv_company_mentions(industry);
CREATE INDEX idx_mv_company_mentions_composite ON public.mv_company_mentions(industry, country, ai_model, theme);

-- Recreate mv_industry_stats with US/UK filter
CREATE MATERIALIZED VIEW public.mv_industry_stats AS
SELECT
  cp.industry_context AS industry,
  cp.location_context AS country,
  pr.ai_model,
  cp.prompt_theme AS theme,
  COUNT(*) as response_count
FROM
  public.prompt_responses pr
JOIN
  public.confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE
  pr.for_index = true
  AND cp.industry_context IS NOT NULL
  AND (
    cp.location_context = 'United States' 
    OR cp.location_context = 'United Kingdom'
  )
GROUP BY
  cp.industry_context,
  cp.location_context,
  pr.ai_model,
  cp.prompt_theme;

CREATE UNIQUE INDEX idx_mv_industry_stats_unique ON public.mv_industry_stats(industry, country, ai_model, theme);

-- Grant permissions
GRANT SELECT ON public.mv_company_mentions TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_industry_stats TO anon, authenticated, service_role;

