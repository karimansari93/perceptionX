-- Script to create a duplicate prompt for Sales Professionals
-- and reassign the appropriate responses

-- STEP 1: Check the existing prompt structure
SELECT 
  'Existing Software Engineers prompt' as section,
  id,
  user_id,
  onboarding_id,
  company_id,
  prompt_text,
  prompt_type,
  prompt_category,
  prompt_theme,
  industry_context,
  job_function_context,
  location_context,
  talentx_attribute_id,
  is_pro_prompt,
  is_active,
  created_at
FROM confirmed_prompts
WHERE id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17';

-- STEP 2: Check if a Sales Professionals prompt already exists
SELECT 
  'Checking for existing Sales Professionals prompt' as section,
  id,
  prompt_text,
  job_function_context,
  created_at
FROM confirmed_prompts
WHERE company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND prompt_type = 'competitive'
  AND prompt_theme = 'Interview Experience'
  AND industry_context = 'Crowfunding'
  AND job_function_context = 'Sales Professionals'
  AND location_context IS NULL;

-- STEP 3: Create the new Sales Professionals prompt
-- First, get the full details of the existing prompt
WITH existing_prompt AS (
  SELECT 
    user_id,
    onboarding_id,
    company_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context,
    talentx_attribute_id,
    is_pro_prompt,
    is_active
  FROM confirmed_prompts
  WHERE id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
)
INSERT INTO confirmed_prompts (
  user_id,
  onboarding_id,
  company_id,
  prompt_text,
  prompt_type,
  prompt_category,
  prompt_theme,
  industry_context,
  job_function_context,
  location_context,
  talentx_attribute_id,
  is_pro_prompt,
  is_active
)
SELECT 
  user_id,
  onboarding_id,
  company_id,
  -- Replace "Software Engineers" with "Sales Professionals"
  REPLACE(prompt_text, 'Software Engineers', 'Sales Professionals') as prompt_text,
  prompt_type,
  prompt_category,
  prompt_theme,
  industry_context,
  'Sales Professionals' as job_function_context,
  location_context,
  talentx_attribute_id,
  is_pro_prompt,
  is_active
FROM existing_prompt
RETURNING id, prompt_text, job_function_context;

-- STEP 4: Identify which responses belong to Sales Professionals
-- This shows what will be reassigned
WITH sales_responses AS (
  SELECT 
    pr.id as response_id,
    pr.confirmed_prompt_id,
    pr.ai_model,
    LEFT(pr.response_text, 200) as response_preview,
    CASE 
      WHEN pr.response_text ILIKE '%sales professional%'
           OR pr.response_text ILIKE '%sales role%'
           OR pr.response_text ILIKE '%sales position%'
           OR pr.response_text ILIKE '%fundraising%'
           OR pr.response_text ILIKE '%customer service%'
           OR pr.response_text ILIKE '%closing deals%'
           OR pr.response_text ILIKE '%sales targets%'
           OR pr.response_text ILIKE '%pipeline management%'
           OR pr.response_text ILIKE '%sales quota%'
           OR (pr.response_text ILIKE '%mission-driven%' AND pr.response_text ILIKE '%sales%')
           OR pr.response_text ILIKE '%GoFundMe%interview process%sales%'
      THEN true
      ELSE false
    END as is_sales_related
  FROM prompt_responses pr
  WHERE pr.confirmed_prompt_id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
)
SELECT 
  'Responses to reassign to Sales Professionals prompt' as section,
  response_id,
  confirmed_prompt_id as current_prompt_id,
  ai_model,
  is_sales_related,
  response_preview
FROM sales_responses
WHERE is_sales_related = true;

-- STEP 5: Get the ID of the newly created Sales Professionals prompt
-- Run this after Step 3 to get the new prompt ID
-- Then update the UPDATE query in Step 6 with this ID
SELECT 
  'New Sales Professionals prompt ID' as section,
  id as new_prompt_id,
  prompt_text,
  job_function_context
FROM confirmed_prompts
WHERE company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND prompt_type = 'competitive'
  AND prompt_theme = 'Interview Experience'
  AND industry_context = 'Crowfunding'
  AND job_function_context = 'Sales Professionals'
  AND location_context IS NULL
  AND id != 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
ORDER BY created_at DESC
LIMIT 1;

-- STEP 6: Reassign Sales-related responses to the new prompt
-- IMPORTANT: Replace 'NEW_PROMPT_ID_HERE' with the actual ID from Step 5
/*
UPDATE prompt_responses
SET confirmed_prompt_id = 'NEW_PROMPT_ID_HERE'  -- Replace with actual ID from Step 5
WHERE confirmed_prompt_id = 'c3e94c50-2cda-44dd-a98c-f2bd4c2e1c17'
  AND (
    response_text ILIKE '%sales professional%'
    OR response_text ILIKE '%sales role%'
    OR response_text ILIKE '%sales position%'
    OR response_text ILIKE '%fundraising%'
    OR response_text ILIKE '%customer service%'
    OR response_text ILIKE '%closing deals%'
    OR response_text ILIKE '%sales targets%'
    OR response_text ILIKE '%pipeline management%'
    OR response_text ILIKE '%sales quota%'
    OR (response_text ILIKE '%mission-driven%' AND response_text ILIKE '%sales%')
    OR response_text ILIKE '%GoFundMe%interview process%sales%'
  );
*/

-- STEP 7: Verification - Check the final state
/*
SELECT 
  'Final verification' as section,
  cp.id as prompt_id,
  cp.job_function_context,
  cp.prompt_text,
  COUNT(pr.id) as response_count,
  STRING_AGG(DISTINCT pr.ai_model, ', ' ORDER BY pr.ai_model) as ai_models
FROM confirmed_prompts cp
LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
WHERE cp.company_id = '60be0418-ff09-4f50-aba6-48a971b7c5c3'
  AND cp.prompt_type = 'competitive'
  AND cp.prompt_theme = 'Interview Experience'
  AND cp.industry_context = 'Crowfunding'
  AND cp.job_function_context IN ('Software Engineers', 'Sales Professionals')
  AND cp.location_context IS NULL
GROUP BY cp.id, cp.job_function_context, cp.prompt_text
ORDER BY cp.job_function_context;
*/




