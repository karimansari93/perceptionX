-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260206063145; this file was
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
  -- 1. Calculate Total Combinations (Denominator)
  SELECT count(DISTINCT m.confirmed_prompt_id)
  INTO v_total_combinations
  FROM mv_company_mentions m
  LEFT JOIN known_sources ks ON m.source = ks.name
  WHERE m.industry = p_industry
    AND m.country = p_country
    AND ks.name IS NULL
    AND (p_model = 'all' OR m.ai_model = p_model);
    
  IF v_total_combinations IS NULL OR v_total_combinations = 0 THEN
    RETURN; 
  END IF;

  -- 2. Return Ranked Companies
  RETURN QUERY
  WITH company_scores AS (
    SELECT
      m.company_name,
      count(DISTINCT m.confirmed_prompt_id) as company_mentions,
      array_agg(DISTINCT m.theme) as themes
    FROM mv_company_mentions m
    LEFT JOIN known_sources ks ON m.source = ks.name
    WHERE m.industry = p_industry
      AND m.country = p_country
      AND ks.name IS NULL
      AND (p_model = 'all' OR m.ai_model = p_model)
    GROUP BY m.company_name
  )
  SELECT
    cs.company_name,
    p_industry as industry,
    p_country as country,
    ROUND((cs.company_mentions::numeric / v_total_combinations::numeric) * 100, 2) as visibility_score,
    (ROW_NUMBER() OVER (ORDER BY cs.company_mentions DESC) + p_offset)::bigint as rank_position,
    cs.company_mentions as mention_count,
    v_total_combinations as total_responses,
    cs.themes,
    ARRAY[p_industry] as all_industries,
    COUNT(*) OVER() as full_count
  FROM company_scores cs
  ORDER BY visibility_score DESC, cs.company_mentions DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$
