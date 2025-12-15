-- Debug script to understand why some companies don't have themes showing
-- This checks the filtering conditions used in ThematicAnalysisTab

-- 1. Check companies and their response counts
SELECT 
  c.id,
  c.name,
  COUNT(DISTINCT pr.id) as total_responses,
  COUNT(DISTINCT CASE 
    WHEN cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
    THEN pr.id 
  END) as sentiment_competitive_responses,
  COUNT(DISTINCT CASE 
    WHEN cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
    AND cp.prompt_category = 'Employee Experience'
    THEN pr.id 
  END) as employee_experience_responses,
  COUNT(DISTINCT CASE 
    WHEN cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
    AND cp.prompt_category = 'Candidate Experience'
    THEN pr.id 
  END) as candidate_experience_responses,
  COUNT(DISTINCT at.id) as ai_themes_count
FROM companies c
LEFT JOIN prompt_responses pr ON pr.company_id = c.id
LEFT JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
LEFT JOIN ai_themes at ON at.response_id = pr.id
GROUP BY c.id, c.name
ORDER BY total_responses DESC
LIMIT 20;

-- 2. Check prompt_type distribution for companies with responses but no themes
SELECT 
  c.id,
  c.name,
  cp.prompt_type,
  cp.prompt_category,
  COUNT(DISTINCT pr.id) as response_count
FROM companies c
JOIN prompt_responses pr ON pr.company_id = c.id
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE NOT EXISTS (
  SELECT 1 FROM ai_themes at WHERE at.response_id = pr.id
)
GROUP BY c.id, c.name, cp.prompt_type, cp.prompt_category
ORDER BY c.name, cp.prompt_type, cp.prompt_category;

-- 3. Check companies with responses but filtered out by prompt_category
SELECT 
  c.id,
  c.name,
  cp.prompt_type,
  cp.prompt_category,
  COUNT(DISTINCT pr.id) as response_count,
  CASE 
    WHEN cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive') 
      AND cp.prompt_category IN ('Employee Experience', 'Candidate Experience')
    THEN 'VALID'
    WHEN cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
      AND cp.prompt_category NOT IN ('Employee Experience', 'Candidate Experience')
    THEN 'INVALID_CATEGORY'
    WHEN cp.prompt_type NOT IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
    THEN 'INVALID_TYPE'
    ELSE 'OTHER'
  END as filter_status
FROM companies c
JOIN prompt_responses pr ON pr.company_id = c.id
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
GROUP BY c.id, c.name, cp.prompt_type, cp.prompt_category
HAVING COUNT(DISTINCT pr.id) > 0
ORDER BY c.name, filter_status, cp.prompt_type;

-- 4. Find companies that should have themes but don't (including General category)
SELECT 
  c.id,
  c.name,
  COUNT(DISTINCT pr.id) as valid_responses,
  COUNT(DISTINCT at.id) as theme_count,
  COUNT(DISTINCT CASE WHEN cp.prompt_category = 'General' THEN pr.id END) as general_responses,
  COUNT(DISTINCT CASE WHEN cp.prompt_category = 'General' THEN at.id END) as general_themes,
  COUNT(DISTINCT CASE WHEN cp.prompt_category = 'Employee Experience' THEN pr.id END) as employee_responses,
  COUNT(DISTINCT CASE WHEN cp.prompt_category = 'Employee Experience' THEN at.id END) as employee_themes
FROM companies c
JOIN prompt_responses pr ON pr.company_id = c.id
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
LEFT JOIN ai_themes at ON at.response_id = pr.id
WHERE cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
  AND cp.prompt_category IN ('Employee Experience', 'Candidate Experience', 'General')
GROUP BY c.id, c.name
HAVING COUNT(DISTINCT pr.id) > 0 AND COUNT(DISTINCT at.id) = 0
ORDER BY valid_responses DESC;

-- 5. Check for companies with themes that might be filtered out
-- This shows companies with themes for General category responses
SELECT 
  c.id,
  c.name,
  cp.prompt_category,
  COUNT(DISTINCT pr.id) as response_count,
  COUNT(DISTINCT at.id) as theme_count
FROM companies c
JOIN prompt_responses pr ON pr.company_id = c.id
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
LEFT JOIN ai_themes at ON at.response_id = pr.id
WHERE cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
  AND cp.prompt_category = 'General'
GROUP BY c.id, c.name, cp.prompt_category
HAVING COUNT(DISTINCT at.id) > 0
ORDER BY theme_count DESC;

-- 6. Summary: Companies with themes by category
SELECT 
  c.name,
  cp.prompt_category,
  COUNT(DISTINCT pr.id) as responses,
  COUNT(DISTINCT at.id) as themes,
  ROUND(100.0 * COUNT(DISTINCT at.id) / NULLIF(COUNT(DISTINCT pr.id), 0), 2) as theme_coverage_pct
FROM companies c
JOIN prompt_responses pr ON pr.company_id = c.id
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
LEFT JOIN ai_themes at ON at.response_id = pr.id
WHERE cp.prompt_type IN ('sentiment', 'competitive', 'talentx_sentiment', 'talentx_competitive')
GROUP BY c.name, cp.prompt_category
ORDER BY c.name, cp.prompt_category;





