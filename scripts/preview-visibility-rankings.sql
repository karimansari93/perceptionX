-- Preview rankings before inserting
-- Use this to see what will be inserted before running the actual INSERT
-- Only includes OpenAI GPT-5o-mini responses

WITH visibility_responses AS (
  SELECT 
    pr.id,
    pr.company_id,
    c.name as company_name,
    c.industry,
    cp.prompt_category as experience_category,
    cp.prompt_theme as theme,
    pr.company_mentioned,
    pr.ai_model,
    pr.tested_at,
    DATE_TRUNC('month', pr.tested_at) as response_month
  FROM prompt_responses pr
  INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  INNER JOIN companies c ON pr.company_id = c.id
  WHERE cp.prompt_type IN ('visibility', 'talentx_visibility')
    AND cp.prompt_category IN ('Employee Experience', 'Candidate Experience')
    AND pr.ai_model ILIKE '%gpt-4o-mini%' -- Filter for cheapest GPT-4 model
    AND pr.tested_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
    AND pr.tested_at < DATE_TRUNC('month', CURRENT_DATE)
),
company_scores AS (
  SELECT 
    company_id,
    company_name,
    industry,
    experience_category,
    theme,
    response_month,
    COUNT(*) as total_responses,
    COUNT(*) FILTER (WHERE company_mentioned = true) as mentioned_count,
    -- Calculate visibility score for preview (frontend will do this)
    (COUNT(*) FILTER (WHERE company_mentioned = true)::float / COUNT(*)::float * 100) as visibility_score_preview
  FROM visibility_responses
  GROUP BY company_id, company_name, industry, experience_category, theme, response_month
  HAVING COUNT(*) >= 3
),
ranked_companies AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY industry, experience_category, theme, response_month 
      ORDER BY (mentioned_count::float / NULLIF(total_responses, 0)) DESC
    ) as rank_position,
    COUNT(*) OVER (
      PARTITION BY industry, experience_category, theme, response_month
    ) as total_companies_in_ranking
  FROM company_scores
)
SELECT 
  response_month as ranking_period,
  company_name,
  industry,
  experience_category,
  theme,
  mentioned_count,
  total_responses,
  visibility_score_preview as visibility_score, -- Preview calculation
  rank_position,
  total_companies_in_ranking
FROM ranked_companies
ORDER BY industry, experience_category, theme, rank_position;

