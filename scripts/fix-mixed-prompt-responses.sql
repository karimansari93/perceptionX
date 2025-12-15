-- Fix script to reassign prompt responses to the correct confirmed_prompt_id
-- based on job_function_context matching

-- This script identifies responses that are assigned to the wrong confirmed_prompt_id
-- and reassigns them to the correct one based on the job_function_context

-- STEP 1: Identify responses that need to be reassigned
-- Responses should be matched to prompts with matching:
-- - prompt_type
-- - prompt_theme  
-- - industry_context
-- - job_function_context (or both NULL)
-- - location_context (or both NULL)

WITH response_classification AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id as current_prompt_id,
    -- Classify the response based on its content
    CASE 
      WHEN pr.response_text ILIKE '%software engineer%' 
           OR pr.response_text ILIKE '%coding%' 
           OR pr.response_text ILIKE '%LeetCode%'
           OR pr.response_text ILIKE '%algorithm%'
           OR pr.response_text ILIKE '%system design%'
           OR pr.response_text ILIKE '%technical interview%'
      THEN 'Software Engineers'
      
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales%' 
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
      THEN 'Sales Professionals'
      
      ELSE NULL
    END as inferred_job_function,
    pr.response_text
  FROM prompt_responses pr
  WHERE pr.confirmed_prompt_id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
),
-- Get the current prompt's attributes
current_prompt AS (
  SELECT 
    id,
    prompt_type,
    prompt_theme,
    industry_context,
    job_function_context,
    location_context,
    prompt_text
  FROM confirmed_prompts
  WHERE id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
),
-- Find the correct prompt for each job function
correct_prompts AS (
  SELECT 
    cp.id as correct_prompt_id,
    cp.prompt_type,
    cp.prompt_theme,
    cp.industry_context,
    cp.job_function_context,
    cp.location_context,
    cp.prompt_text
  FROM confirmed_prompts cp
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
    AND cp.prompt_text LIKE '%interview process%'
    AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
    -- Match the same prompt_type, prompt_theme, industry_context, location_context
    AND EXISTS (
      SELECT 1 FROM current_prompt cp2 
      WHERE cp.prompt_type = cp2.prompt_type
        AND (cp.prompt_theme IS NULL AND cp2.prompt_theme IS NULL OR cp.prompt_theme = cp2.prompt_theme)
        AND (cp.industry_context IS NULL AND cp2.industry_context IS NULL OR cp.industry_context = cp2.industry_context)
        AND (cp.location_context IS NULL AND cp2.location_context IS NULL OR cp.location_context = cp2.location_context)
    )
)
-- Preview what will be reassigned
SELECT 
  rc.response_id,
  rc.current_prompt_id,
  rc.inferred_job_function,
  cp.correct_prompt_id,
  cp.job_function_context as correct_job_function,
  CASE 
    WHEN rc.inferred_job_function = cp.job_function_context THEN 'MATCH - Will reassign'
    WHEN rc.inferred_job_function IS NULL THEN 'UNKNOWN - Check manually'
    ELSE 'MISMATCH - Check manually'
  END as reassignment_status
FROM response_classification rc
LEFT JOIN correct_prompts cp ON rc.inferred_job_function = cp.job_function_context
ORDER BY rc.response_id;

-- STEP 2: Actually perform the reassignment
-- Uncomment and run this section after reviewing the preview above

/*
WITH response_classification AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id as current_prompt_id,
    CASE 
      WHEN pr.response_text ILIKE '%software engineer%' 
           OR pr.response_text ILIKE '%coding%' 
           OR pr.response_text ILIKE '%LeetCode%'
           OR pr.response_text ILIKE '%algorithm%'
           OR pr.response_text ILIKE '%system design%'
           OR pr.response_text ILIKE '%technical interview%'
      THEN 'Software Engineers'
      
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales%' 
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
      THEN 'Sales Professionals'
      
      ELSE NULL
    END as inferred_job_function
  FROM prompt_responses pr
  WHERE pr.confirmed_prompt_id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
),
current_prompt AS (
  SELECT 
    id,
    prompt_type,
    prompt_theme,
    industry_context,
    job_function_context,
    location_context
  FROM confirmed_prompts
  WHERE id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
),
correct_prompts AS (
  SELECT 
    cp.id as correct_prompt_id,
    cp.prompt_type,
    cp.prompt_theme,
    cp.industry_context,
    cp.job_function_context,
    cp.location_context
  FROM confirmed_prompts cp
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
    AND cp.prompt_text LIKE '%interview process%'
    AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
    AND EXISTS (
      SELECT 1 FROM current_prompt cp2 
      WHERE cp.prompt_type = cp2.prompt_type
        AND (cp.prompt_theme IS NULL AND cp2.prompt_theme IS NULL OR cp.prompt_theme = cp2.prompt_theme)
        AND (cp.industry_context IS NULL AND cp2.industry_context IS NULL OR cp.industry_context = cp2.industry_context)
        AND (cp.location_context IS NULL AND cp2.location_context IS NULL OR cp.location_context = cp2.location_context)
    )
)
UPDATE prompt_responses pr
SET confirmed_prompt_id = cp.correct_prompt_id
FROM response_classification rc
JOIN correct_prompts cp ON rc.inferred_job_function = cp.job_function_context
WHERE pr.id = rc.response_id
  AND rc.inferred_job_function IS NOT NULL
  AND rc.inferred_job_function = cp.job_function_context
  AND rc.current_prompt_id != cp.correct_prompt_id;
*/

-- STEP 3: Verification query - check the results after reassignment
-- Run this after the UPDATE to verify the fix worked

/*
SELECT 
  cp.id as prompt_id,
  cp.job_function_context,
  COUNT(pr.id) as response_count,
  STRING_AGG(DISTINCT pr.ai_model, ', ') as ai_models
FROM confirmed_prompts cp
LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND cp.prompt_text LIKE '%interview process%'
  AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
GROUP BY cp.id, cp.job_function_context
ORDER BY cp.job_function_context;
*/





