-- Fix data distribution to link prompts to the correct companies based on onboarding data

-- 1. First, let's see what we have
-- This will help us understand the current state

-- 2. Update confirmed_prompts to link to the correct company based on onboarding data
UPDATE confirmed_prompts 
SET company_id = (
  SELECT c.id 
  FROM companies c
  INNER JOIN user_onboarding uo ON uo.company_name = c.name AND uo.industry = c.industry
  WHERE uo.id = confirmed_prompts.onboarding_id
  LIMIT 1
)
WHERE company_id IS NULL 
AND onboarding_id IS NOT NULL;

-- 3. For any remaining prompts without onboarding_id, link to user's default company
UPDATE confirmed_prompts 
SET company_id = (
  SELECT cm.company_id 
  FROM company_members cm 
  WHERE cm.user_id = confirmed_prompts.user_id 
  AND cm.is_default = true 
  LIMIT 1
)
WHERE company_id IS NULL 
AND user_id IS NOT NULL;

-- 4. Update prompt_responses to link to companies via confirmed_prompts
UPDATE prompt_responses 
SET company_id = (
  SELECT cp.company_id 
  FROM confirmed_prompts cp 
  WHERE cp.id = prompt_responses.confirmed_prompt_id
)
WHERE company_id IS NULL;

-- 5. Update search_insights_sessions to link to companies
UPDATE search_insights_sessions 
SET company_id = (
  SELECT cm.company_id 
  FROM company_members cm 
  WHERE cm.user_id = search_insights_sessions.user_id 
  AND cm.is_default = true 
  LIMIT 1
)
WHERE company_id IS NULL 
AND user_id IS NOT NULL;

-- 6. Add created_by fields if missing
UPDATE confirmed_prompts 
SET created_by = user_id
WHERE created_by IS NULL 
AND user_id IS NOT NULL;

UPDATE search_insights_sessions 
SET created_by = user_id
WHERE created_by IS NULL 
AND user_id IS NOT NULL;


