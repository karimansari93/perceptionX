-- Diagnostic script to identify mixed-up prompt responses
-- This finds cases where responses for different job functions are assigned to the same confirmed_prompt_id

-- Step 1: Find confirmed prompts that have responses with conflicting job function contexts
WITH prompt_contexts AS (
  SELECT DISTINCT
    cp.id as confirmed_prompt_id,
    cp.prompt_text,
    cp.prompt_type,
    cp.prompt_theme,
    cp.industry_context,
    cp.job_function_context as prompt_job_function,
    cp.location_context,
    COUNT(DISTINCT pr.id) as response_count
  FROM confirmed_prompts cp
  JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3' -- GoFundMe company ID
    AND cp.job_function_context IS NOT NULL
  GROUP BY cp.id, cp.prompt_text, cp.prompt_type, cp.prompt_theme, 
           cp.industry_context, cp.job_function_context, cp.location_context
)
SELECT 
  'Prompts with job function context' as check_type,
  COUNT(*) as prompt_count,
  SUM(response_count) as total_responses
FROM prompt_contexts;

-- Step 2: Find the specific problematic confirmed_prompt_id mentioned
SELECT 
  'Problematic prompt' as check_type,
  cp.id as confirmed_prompt_id,
  cp.prompt_text,
  cp.prompt_type,
  cp.prompt_theme,
  cp.industry_context,
  cp.job_function_context,
  cp.location_context,
  COUNT(pr.id) as response_count
FROM confirmed_prompts cp
LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
WHERE cp.id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
GROUP BY cp.id, cp.prompt_text, cp.prompt_type, cp.prompt_theme, 
         cp.industry_context, cp.job_function_context, cp.location_context;

-- Step 3: Find all prompts with the same prompt_text but different job_function_context
-- This will help identify which prompts should exist
SELECT 
  'Prompts with same text, different job functions' as check_type,
  cp.prompt_text,
  cp.prompt_type,
  cp.prompt_theme,
  cp.industry_context,
  COUNT(DISTINCT cp.job_function_context) as distinct_job_functions,
  STRING_AGG(DISTINCT cp.job_function_context, ', ') as job_functions,
  STRING_AGG(DISTINCT cp.id::text, ', ') as prompt_ids,
  SUM((SELECT COUNT(*) FROM prompt_responses pr WHERE pr.confirmed_prompt_id = cp.id)) as total_responses
FROM confirmed_prompts cp
WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND cp.prompt_text LIKE '%interview process%'
  AND cp.job_function_context IS NOT NULL
GROUP BY cp.prompt_text, cp.prompt_type, cp.prompt_theme, cp.industry_context
HAVING COUNT(DISTINCT cp.job_function_context) > 1;

-- Step 4: Show all responses for the problematic prompt ID and their content
-- This helps identify which responses belong to which job function
SELECT 
  'Responses for problematic prompt' as check_type,
  pr.id as response_id,
  pr.confirmed_prompt_id,
  pr.ai_model,
  LEFT(pr.response_text, 200) as response_preview,
  pr.created_at,
  CASE 
    WHEN pr.response_text ILIKE '%software engineer%' OR pr.response_text ILIKE '%coding%' OR pr.response_text ILIKE '%LeetCode%' THEN 'Software Engineer'
    WHEN pr.response_text ILIKE '%sales%' OR pr.response_text ILIKE '%fundraising%' OR pr.response_text ILIKE '%customer service%' THEN 'Sales Professional'
    ELSE 'Unknown'
  END as inferred_job_function
FROM prompt_responses pr
WHERE pr.confirmed_prompt_id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
ORDER BY pr.created_at;

-- Step 5: Find the correct prompt IDs that should exist for each job function
SELECT 
  'Correct prompts by job function' as check_type,
  cp.id as correct_prompt_id,
  cp.prompt_text,
  cp.prompt_type,
  cp.prompt_theme,
  cp.industry_context,
  cp.job_function_context,
  cp.location_context,
  (SELECT COUNT(*) FROM prompt_responses pr WHERE pr.confirmed_prompt_id = cp.id) as current_response_count
FROM confirmed_prompts cp
WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND cp.prompt_text LIKE '%interview process%'
  AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
ORDER BY cp.job_function_context, cp.created_at;


















