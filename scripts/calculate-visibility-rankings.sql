-- Manual script to calculate and insert visibility rankings
-- Run this monthly to populate the visibility_rankings table
-- Only includes OpenAI GPT-5o-mini responses (cheapest GPT-5 model)
-- Stores raw counts - frontend calculates visibility_score

-- Adjust the date range below to target the month you want to rank
-- Currently set to last month's data

WITH visibility_responses AS (
  SELECT 
    pr.id,
    pr.company_id,
    c.name as company_name,
    c.industry,
    cp.prompt_category as experience_category,
    cp.prompt_theme as theme,
    pr.company_mentioned,
    pr.detected_competitors,
    pr.tested_at,
    DATE_TRUNC('month', pr.tested_at) as response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE cp.prompt_type IN ('visibility', 'talentx_visibility')
    AND cp.prompt_category IN ('Employee Experience', 'Candidate Experience')
    AND pr.ai_model ILIKE '%gpt-4o-mini%' -- Filter for cheapest GPT-4 model (gpt-4o-mini)
    AND pr.tested_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') -- Last month
    AND pr.tested_at < DATE_TRUNC('month', CURRENT_DATE)
),
-- Expand competitors into individual rows
competitors_expanded AS (
  SELECT 
    company_id,
    company_name,
    industry,
    experience_category,
    theme,
    response_month,
    TRIM(UNNEST(STRING_TO_ARRAY(detected_competitors, ','))) as competitor
  FROM visibility_responses
  WHERE detected_competitors IS NOT NULL 
    AND detected_competitors != ''
),
-- Aggregate unique competitors per company/theme
competitors_aggregated AS (
  SELECT 
    company_id,
    experience_category,
    theme,
    response_month,
    STRING_AGG(DISTINCT competitor, ', ' ORDER BY competitor) as detected_competitors
  FROM competitors_expanded
  WHERE competitor IS NOT NULL AND TRIM(competitor) != ''
  GROUP BY company_id, experience_category, theme, response_month
),
company_scores AS (
  SELECT 
    vr.company_id,
    vr.company_name,
    vr.industry,
    vr.experience_category,
    vr.theme,
    vr.response_month,
    COUNT(*) as total_responses,
    COUNT(*) FILTER (WHERE vr.company_mentioned = true) as mentioned_count,
    ca.detected_competitors
  FROM visibility_responses vr
  LEFT JOIN competitors_aggregated ca 
    ON vr.company_id = ca.company_id
    AND vr.experience_category = ca.experience_category
    AND vr.theme = ca.theme
    AND vr.response_month = ca.response_month
  GROUP BY vr.company_id, vr.company_name, vr.industry, vr.experience_category, vr.theme, vr.response_month, ca.detected_competitors
  HAVING COUNT(*) >= 3 -- Only include companies with at least 3 responses
),
ranked_companies AS (
  SELECT 
    *,
    -- Rank by visibility ratio (mentioned_count / total_responses)
    ROW_NUMBER() OVER (
      PARTITION BY industry, experience_category, theme, response_month 
      ORDER BY (mentioned_count::float / NULLIF(total_responses, 0)) DESC
    ) as rank_position,
    COUNT(*) OVER (
      PARTITION BY industry, experience_category, theme, response_month
    ) as total_companies_in_ranking
  FROM company_scores
)
-- Insert into visibility_rankings table
INSERT INTO visibility_rankings (
  ranking_period,
  company_id,
  industry,
  country,
  experience_category,
  theme,
  visibility_score, -- Store as NULL, frontend will calculate
  detected_competitors,
  rank_position,
  total_companies_in_ranking,
  created_at,
  updated_at
)
SELECT 
  response_month as ranking_period,
  company_id,
  industry,
  'US' as country,
  experience_category,
  theme,
  NULL as visibility_score, -- Frontend calculates: (mentioned_count / total_responses) * 100
  detected_competitors,
  rank_position,
  total_companies_in_ranking,
  NOW() as created_at,
  NOW() as updated_at
FROM ranked_companies
ON CONFLICT (ranking_period, company_id, industry, country, experience_category, theme)
DO UPDATE SET
  rank_position = EXCLUDED.rank_position,
  detected_competitors = EXCLUDED.detected_competitors,
  total_companies_in_ranking = EXCLUDED.total_companies_in_ranking,
  updated_at = NOW();

-- Show summary of inserted/updated rankings
SELECT 
  ranking_period,
  industry,
  experience_category,
  theme,
  COUNT(*) as companies_ranked,
  MIN(rank_position) as top_rank,
  MAX(rank_position) as bottom_rank
FROM visibility_rankings
WHERE ranking_period = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
GROUP BY ranking_period, industry, experience_category, theme
ORDER BY ranking_period DESC, industry, experience_category, theme;

