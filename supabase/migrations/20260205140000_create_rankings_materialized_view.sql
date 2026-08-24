-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260205140000; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Drop existing views if they exist (to allow for updates)
DROP MATERIALIZED VIEW IF EXISTS public.mv_company_mentions
DROP MATERIALIZED VIEW IF EXISTS public.mv_industry_stats
-- Create a materialized view to pre-calculate company mentions
-- This replaces the heavy client-side processing of thousands of rows
-- It handles:
-- 1. Splitting the detected_competitors CSV string into individual rows
-- 2. Basic cleaning (trimming whitespace and quotes)
-- 3. Aggregating counts by industry, country, company, model, and theme

CREATE MATERIALIZED VIEW public.mv_company_mentions AS
WITH raw_data AS (
  SELECT
    pr.id AS response_id,
    pr.ai_model,
    cp.industry_context AS industry,
    cp.location_context AS country, -- Added country
    cp.prompt_theme AS theme,
    pr.detected_competitors
  FROM
    public.prompt_responses pr
  JOIN
    public.confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE
    pr.for_index = true
    AND cp.industry_context IS NOT NULL
),
split_data AS (
  SELECT
    industry,
    country,
    ai_model,
    theme,
    -- Split by comma, semicolon, or newline
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
  -- Clean up the company name (remove quotes and whitespace) mimics stripQuotes()
  TRIM(BOTH ' "' FROM TRIM(raw_company_name)) AS company_name,
  ai_model,
  theme,
  COUNT(*) as mention_count
FROM
  split_data
WHERE
  length(TRIM(BOTH ' "' FROM TRIM(raw_company_name))) >= 2 -- Basic filter for empty/short strings
GROUP BY
  industry,
  country,
  TRIM(BOTH ' "' FROM TRIM(raw_company_name)),
  ai_model,
  theme
-- Create index for fast filtering by industry
CREATE INDEX idx_mv_company_mentions_industry ON public.mv_company_mentions(industry)
-- Create index for fast lookups
CREATE INDEX idx_mv_company_mentions_composite ON public.mv_company_mentions(industry, country, ai_model, theme)
-- Create a second materialized view for industry statistics (denominators)
-- We need this to calculate visibility scores (total unique model+theme combinations per industry+country)
CREATE MATERIALIZED VIEW public.mv_industry_stats AS
SELECT
  cp.industry_context AS industry,
  cp.location_context AS country, -- Added country
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
GROUP BY
  cp.industry_context,
  cp.location_context,
  pr.ai_model,
  cp.prompt_theme
CREATE UNIQUE INDEX idx_mv_industry_stats_unique ON public.mv_industry_stats(industry, country, ai_model, theme)
-- Grant permissions
GRANT SELECT ON public.mv_company_mentions TO anon, authenticated, service_role
GRANT SELECT ON public.mv_industry_stats TO anon, authenticated, service_role
-- Create a helper function to refresh these views
-- This can be called via cron or trigger
CREATE OR REPLACE FUNCTION refresh_rankings_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_industry_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_company_mentions;
END;
$$ LANGUAGE plpgsql
