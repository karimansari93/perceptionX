-- Fix existing data to link prompts and responses to companies

-- 1. Update confirmed_prompts to link to user's default company
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

-- 2. Update prompt_responses to link to companies via confirmed_prompts
UPDATE prompt_responses 
SET company_id = (
  SELECT cp.company_id 
  FROM confirmed_prompts cp 
  WHERE cp.id = prompt_responses.confirmed_prompt_id
)
WHERE company_id IS NULL;

-- 3. Update search_insights_sessions to link to companies
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

-- 4. Add created_by to confirmed_prompts if missing
UPDATE confirmed_prompts 
SET created_by = user_id
WHERE created_by IS NULL 
AND user_id IS NOT NULL;

-- 5. Add created_by to search_insights_sessions if missing
UPDATE search_insights_sessions 
SET created_by = user_id
WHERE created_by IS NULL 
AND user_id IS NOT NULL;


