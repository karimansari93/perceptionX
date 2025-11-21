-- ============================================================================
-- Verification Query: Count Positive and Negative Themes by Company
-- ============================================================================
-- This query helps verify that sentiment calculation is working correctly
-- by counting themes grouped by company_id

-- Option 1: Get theme counts for a specific company (replace with your company_id)
SELECT 
  pr.company_id,
  c.name as company_name,
  COUNT(*) as total_themes,
  COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) as positive_themes,
  COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END) as negative_themes,
  COUNT(CASE WHEN at.sentiment_score >= -0.1 AND at.sentiment_score <= 0.1 THEN 1 END) as neutral_themes,
  ROUND(
    COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END)::numeric / 
    NULLIF(COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) + COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END), 0) * 100, 
    2
  ) as positive_ratio_percent,
  ROUND(AVG(at.sentiment_score)::numeric, 3) as avg_sentiment_score
FROM ai_themes at
INNER JOIN prompt_responses pr ON at.response_id = pr.id
INNER JOIN companies c ON pr.company_id = c.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'  -- Your company ID
  AND pr.confirmed_prompts IS NOT NULL
GROUP BY pr.company_id, c.name
ORDER BY total_themes DESC;

-- Option 2: Get theme counts for ALL companies
SELECT 
  pr.company_id,
  c.name as company_name,
  COUNT(*) as total_themes,
  COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) as positive_themes,
  COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END) as negative_themes,
  COUNT(CASE WHEN at.sentiment_score >= -0.1 AND at.sentiment_score <= 0.1 THEN 1 END) as neutral_themes,
  ROUND(
    COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END)::numeric / 
    NULLIF(COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) + COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END), 0) * 100, 
    2
  ) as positive_ratio_percent,
  ROUND(AVG(at.sentiment_score)::numeric, 3) as avg_sentiment_score
FROM ai_themes at
INNER JOIN prompt_responses pr ON at.response_id = pr.id
INNER JOIN companies c ON pr.company_id = c.id
WHERE pr.company_id IS NOT NULL
GROUP BY pr.company_id, c.name
ORDER BY total_themes DESC;

-- Option 3: Get theme counts filtered by prompt type (sentiment/competitive only)
-- This matches what the dashboard actually uses
SELECT 
  pr.company_id,
  c.name as company_name,
  cp.prompt_type,
  COUNT(*) as total_themes,
  COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) as positive_themes,
  COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END) as negative_themes,
  COUNT(CASE WHEN at.sentiment_score >= -0.1 AND at.sentiment_score <= 0.1 THEN 1 END) as neutral_themes,
  ROUND(
    COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END)::numeric / 
    NULLIF(COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) + COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END), 0) * 100, 
    2
  ) as positive_ratio_percent
FROM ai_themes at
INNER JOIN prompt_responses pr ON at.response_id = pr.id
INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
INNER JOIN companies c ON pr.company_id = c.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'  -- Your company ID
  AND cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
GROUP BY pr.company_id, c.name, cp.prompt_type
ORDER BY total_themes DESC;

-- Option 4: Detailed breakdown by response (for debugging)
SELECT 
  pr.id as response_id,
  pr.company_id,
  c.name as company_name,
  cp.prompt_type,
  COUNT(*) as total_themes,
  COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) as positive_themes,
  COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END) as negative_themes,
  ROUND(
    COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END)::numeric / 
    NULLIF(COUNT(CASE WHEN at.sentiment_score > 0.1 THEN 1 END) + COUNT(CASE WHEN at.sentiment_score < -0.1 THEN 1 END), 0), 
    3
  ) as sentiment_ratio
FROM ai_themes at
INNER JOIN prompt_responses pr ON at.response_id = pr.id
INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
INNER JOIN companies c ON pr.company_id = c.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'  -- Your company ID
  AND cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
GROUP BY pr.id, pr.company_id, c.name, cp.prompt_type
ORDER BY pr.tested_at DESC
LIMIT 20;

