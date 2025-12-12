-- Find missing prompts or identify if Sales Professionals prompt exists
-- This script helps identify if we need to create a new prompt for Sales Professionals

-- Step 1: Check if Sales Professionals prompt exists for this prompt text/type/theme
SELECT 
  'Existing prompts for interview process' as check_type,
  cp.id as prompt_id,
  cp.prompt_text,
  cp.prompt_type,
  cp.prompt_theme,
  cp.industry_context,
  cp.job_function_context,
  cp.location_context,
  COUNT(pr.id) as response_count,
  cp.created_at
FROM confirmed_prompts cp
LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND cp.prompt_text LIKE '%interview process%'
  AND cp.prompt_type = 'competitive'
  AND cp.prompt_theme = 'Interview Experience'
  AND cp.industry_context = 'Crowfunding'
GROUP BY cp.id, cp.prompt_text, cp.prompt_type, cp.prompt_theme, 
         cp.industry_context, cp.job_function_context, cp.location_context, cp.created_at
ORDER BY cp.job_function_context NULLS LAST, cp.created_at;

-- Step 2: Check what job functions should exist based on responses
WITH response_classification AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id,
    pr.ai_model,
    -- Classify responses
    CASE 
      WHEN pr.response_text ILIKE '%software engineer%' 
           OR pr.response_text ILIKE '%coding%'
           OR pr.response_text ILIKE '%LeetCode%'
           OR pr.response_text ILIKE '%algorithm%'
           OR pr.response_text ILIKE '%system design%'
           OR pr.response_text ILIKE '%technical interview%'
           OR pr.response_text ILIKE '%programming%'
           OR pr.response_text ILIKE '%Java%'
           OR pr.response_text ILIKE '%Python%'
           OR pr.response_text ILIKE '%Kotlin%'
           OR pr.response_text ILIKE '%PHP%'
      THEN 'Software Engineers'
      
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales%' 
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
           OR pr.response_text ILIKE '%pipeline management%'
           OR pr.response_text ILIKE '%sales quota%'
      THEN 'Sales Professionals'
      
      ELSE 'Unknown'
    END as inferred_job_function
  FROM prompt_responses pr
  WHERE pr.confirmed_prompt_id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
)
SELECT 
  'Response classification' as check_type,
  inferred_job_function,
  COUNT(*) as response_count,
  STRING_AGG(DISTINCT ai_model, ', ') as ai_models
FROM response_classification
GROUP BY inferred_job_function
ORDER BY inferred_job_function;

-- Step 3: Show what the Sales Professionals prompt SHOULD look like
SELECT 
  'Expected Sales Professionals prompt' as check_type,
  'Should match Software Engineers prompt but with different job_function_context' as note,
  prompt_text,
  prompt_type,
  prompt_theme,
  industry_context,
  'Sales Professionals' as expected_job_function_context,
  location_context
FROM confirmed_prompts
WHERE id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17';




