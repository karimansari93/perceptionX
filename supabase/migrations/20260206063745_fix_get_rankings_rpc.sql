-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260206063745; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Drop if exists
DROP FUNCTION IF EXISTS get_rankings(text, text, text, int, int)
CREATE OR REPLACE FUNCTION get_rankings(
  p_industry text,
  p_country text,
  p_model text DEFAULT 'all',
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  company_name text,
  industry text,
  country text,
  visibility_score numeric,
  rank_position bigint,
  mention_count bigint,
  total_responses bigint,
  themes text[],
  all_industries text[],
  full_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_combinations bigint;
BEGIN
  -- 1. Calculate Total Responses (Denominator) from mv_industry_stats
  -- mv_industry_stats has response_count which is aggregated total prompts
  SELECT SUM(response_count)
  INTO v_total_combinations
  FROM mv_industry_stats s
  WHERE s.industry = p_industry
    AND s.country = p_country
    AND (p_model = 'all' OR s.ai_model = p_model);
    
  IF v_total_combinations IS NULL OR v_total_combinations = 0 THEN
    RETURN; 
  END IF;

  -- 2. Return Ranked Companies from mv_company_mentions
  -- mv_company_mentions has mention_count which is aggregated company mentions
  RETURN QUERY
  WITH company_scores AS (
    SELECT
      m.company_name,
      SUM(m.mention_count) as company_mentions,
      array_agg(DISTINCT m.theme) as themes
    FROM mv_company_mentions m
    WHERE m.industry = p_industry
      AND m.country = p_country
      AND (p_model = 'all' OR m.ai_model = p_model)
    GROUP BY m.company_name
  )
  SELECT
    cs.company_name,
    p_industry as industry,
    p_country as country,
    ROUND((cs.company_mentions::numeric / v_total_combinations::numeric) * 100, 2) as visibility_score,
    (ROW_NUMBER() OVER (ORDER BY (cs.company_mentions::numeric / v_total_combinations::numeric) DESC) + p_offset)::bigint as rank_position,
    cs.company_mentions as mention_count,
    v_total_combinations as total_responses,
    cs.themes,
    ARRAY[p_industry] as all_industries,
    COUNT(*) OVER() as full_count
  FROM company_scores cs
  ORDER BY visibility_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$
