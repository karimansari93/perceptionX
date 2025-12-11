-- Comprehensive fix script for mixed-up prompt responses
-- This script identifies and fixes cases where responses are assigned to the wrong confirmed_prompt_id
-- based on job_function_context mismatch

-- The approach:
-- 1. Identify all confirmed prompts that have responses
-- 2. For each response, infer the job function from its content
-- 3. Find the correct confirmed_prompt_id that matches the inferred job function
-- 4. Reassign responses to the correct prompts

-- STEP 1: Diagnostic - Show all problematic assignments
WITH response_analysis AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id,
    pr.ai_model,
    LEFT(pr.response_text, 150) as response_preview,
    -- Infer job function from response content
    CASE 
      WHEN pr.response_text ILIKE '%software engineer%' 
           OR pr.response_text ILIKE '%coding interview%'
           OR pr.response_text ILIKE '%LeetCode%'
           OR pr.response_text ILIKE '%algorithm%'
           OR pr.response_text ILIKE '%data structure%'
           OR pr.response_text ILIKE '%system design%'
           OR pr.response_text ILIKE '%technical interview%'
           OR pr.response_text ILIKE '%programming%'
           OR pr.response_text ILIKE '%Java%'
           OR pr.response_text ILIKE '%Python%'
           OR pr.response_text ILIKE '%Kotlin%'
           OR pr.response_text ILIKE '%PHP%'
      THEN 'Software Engineers'
      
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales role%'
           OR pr.response_text ILIKE '%sales position%'
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
           OR pr.response_text ILIKE '%pipeline management%'
           OR pr.response_text ILIKE '%sales quota%'
           OR pr.response_text ILIKE '%mission-driven%' AND pr.response_text ILIKE '%sales%'
      THEN 'Sales Professionals'
      
      ELSE NULL
    END as inferred_job_function
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
),
prompt_info AS (
  SELECT 
    cp.id as prompt_id,
    cp.prompt_text,
    cp.prompt_type,
    cp.prompt_theme,
    cp.industry_context,
    cp.job_function_context,
    cp.location_context
  FROM confirmed_prompts cp
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
)
SELECT 
  'DIAGNOSTIC: Current state' as section,
  ra.response_id,
  ra.confirmed_prompt_id as current_prompt_id,
  pi_prompt.job_function_context as prompt_job_function,
  ra.inferred_job_function as response_inferred_job_function,
  CASE 
    WHEN pi_prompt.job_function_context = ra.inferred_job_function THEN '✓ CORRECT'
    WHEN ra.inferred_job_function IS NULL THEN '⚠ UNKNOWN - Manual review needed'
    ELSE '✗ MISMATCH - Needs reassignment'
  END as status
FROM response_analysis ra
JOIN prompt_info pi_prompt ON ra.confirmed_prompt_id = pi_prompt.prompt_id
WHERE pi_prompt.job_function_context IN ('Software Engineers', 'Sales Professionals')
  OR ra.inferred_job_function IS NOT NULL
ORDER BY ra.confirmed_prompt_id, ra.response_id;

-- STEP 2: Find correct prompt matches
-- This shows which prompts should receive which responses
WITH response_analysis AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id as current_prompt_id,
    pr.ai_model,
    -- Infer job function from response content
    CASE 
      WHEN pr.response_text ILIKE '%software engineer%' 
           OR pr.response_text ILIKE '%coding interview%'
           OR pr.response_text ILIKE '%LeetCode%'
           OR pr.response_text ILIKE '%algorithm%'
           OR pr.response_text ILIKE '%data structure%'
           OR pr.response_text ILIKE '%system design%'
           OR pr.response_text ILIKE '%technical interview%'
           OR pr.response_text ILIKE '%programming%'
           OR pr.response_text ILIKE '%Java%'
           OR pr.response_text ILIKE '%Python%'
           OR pr.response_text ILIKE '%Kotlin%'
           OR pr.response_text ILIKE '%PHP%'
      THEN 'Software Engineers'
      
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales role%'
           OR pr.response_text ILIKE '%sales position%'
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
           OR pr.response_text ILIKE '%pipeline management%'
           OR pr.response_text ILIKE '%sales quota%'
           OR pr.response_text ILIKE '%mission-driven%' AND pr.response_text ILIKE '%sales%'
      THEN 'Sales Professionals'
      
      ELSE NULL
    END as inferred_job_function
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
),
current_prompt_attrs AS (
  SELECT DISTINCT
    cp.id,
    cp.prompt_type,
    cp.prompt_theme,
    cp.industry_context,
    cp.location_context
  FROM confirmed_prompts cp
  JOIN response_analysis ra ON cp.id = ra.current_prompt_id
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
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
    AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
)
SELECT 
  'REASSIGNMENT PLAN' as section,
  ra.response_id,
  ra.current_prompt_id,
  ra.inferred_job_function,
  cp.correct_prompt_id,
  cp.job_function_context as target_job_function,
  CASE 
    WHEN ra.inferred_job_function = cp.job_function_context 
         AND ra.current_prompt_id != cp.correct_prompt_id THEN 'WILL REASSIGN'
    WHEN ra.inferred_job_function = cp.job_function_context 
         AND ra.current_prompt_id = cp.correct_prompt_id THEN 'ALREADY CORRECT'
    WHEN ra.inferred_job_function IS NULL THEN 'SKIP - Manual review'
    ELSE 'NO MATCH FOUND'
  END as action
FROM response_analysis ra
LEFT JOIN current_prompt_attrs cpa ON ra.current_prompt_id = cpa.id
LEFT JOIN correct_prompts cp ON 
  ra.inferred_job_function = cp.job_function_context
  AND cpa.prompt_type = cp.prompt_type
  AND (cpa.prompt_theme IS NULL AND cp.prompt_theme IS NULL OR cpa.prompt_theme = cp.prompt_theme)
  AND (cpa.industry_context IS NULL AND cp.industry_context IS NULL OR cpa.industry_context = cp.industry_context)
  AND (cpa.location_context IS NULL AND cp.location_context IS NULL OR cpa.location_context = cp.location_context)
WHERE ra.inferred_job_function IS NOT NULL
ORDER BY ra.response_id;

-- STEP 3: Perform the actual reassignment
-- UNCOMMENT AND RUN THIS AFTER REVIEWING THE PLAN ABOVE

/*
WITH response_analysis AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id as current_prompt_id,
    CASE 
      WHEN pr.response_text ILIKE '%software engineer%' 
           OR pr.response_text ILIKE '%coding interview%'
           OR pr.response_text ILIKE '%LeetCode%'
           OR pr.response_text ILIKE '%algorithm%'
           OR pr.response_text ILIKE '%data structure%'
           OR pr.response_text ILIKE '%system design%'
           OR pr.response_text ILIKE '%technical interview%'
           OR pr.response_text ILIKE '%programming%'
           OR pr.response_text ILIKE '%Java%'
           OR pr.response_text ILIKE '%Python%'
           OR pr.response_text ILIKE '%Kotlin%'
           OR pr.response_text ILIKE '%PHP%'
      THEN 'Software Engineers'
      
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales role%'
           OR pr.response_text ILIKE '%sales position%'
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
           OR pr.response_text ILIKE '%pipeline management%'
           OR pr.response_text ILIKE '%sales quota%'
           OR pr.response_text ILIKE '%mission-driven%' AND pr.response_text ILIKE '%sales%'
      THEN 'Sales Professionals'
      
      ELSE NULL
    END as inferred_job_function
  FROM prompt_responses pr
  JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
),
current_prompt_attrs AS (
  SELECT DISTINCT
    cp.id,
    cp.prompt_type,
    cp.prompt_theme,
    cp.industry_context,
    cp.location_context
  FROM confirmed_prompts cp
  JOIN response_analysis ra ON cp.id = ra.current_prompt_id
  WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
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
    AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
)
UPDATE prompt_responses pr
SET confirmed_prompt_id = cp.correct_prompt_id
FROM response_analysis ra
JOIN current_prompt_attrs cpa ON ra.current_prompt_id = cpa.id
JOIN correct_prompts cp ON 
  ra.inferred_job_function = cp.job_function_context
  AND cpa.prompt_type = cp.prompt_type
  AND (cpa.prompt_theme IS NULL AND cp.prompt_theme IS NULL OR cpa.prompt_theme = cp.prompt_theme)
  AND (cpa.industry_context IS NULL AND cp.industry_context IS NULL OR cpa.industry_context = cp.industry_context)
  AND (cpa.location_context IS NULL AND cp.location_context IS NULL OR cpa.location_context = cp.location_context)
WHERE pr.id = ra.response_id
  AND ra.inferred_job_function IS NOT NULL
  AND ra.current_prompt_id != cp.correct_prompt_id;
*/

-- STEP 4: Verification - Check results after reassignment
/*
SELECT 
  'VERIFICATION: Final state' as section,
  cp.id as prompt_id,
  cp.job_function_context,
  cp.prompt_type,
  cp.prompt_theme,
  COUNT(pr.id) as response_count,
  STRING_AGG(DISTINCT pr.ai_model, ', ' ORDER BY pr.ai_model) as ai_models
FROM confirmed_prompts cp
LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND cp.prompt_text LIKE '%interview process%'
  AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
GROUP BY cp.id, cp.job_function_context, cp.prompt_type, cp.prompt_theme
ORDER BY cp.job_function_context, cp.prompt_type;
*/



