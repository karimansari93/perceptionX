-- Fix company_id in confirmed_prompts table
-- This script populates the company_id field for existing prompts

-- Step 1: Check current state
SELECT 
  COUNT(*) as total_prompts,
  COUNT(company_id) as prompts_with_company_id,
  COUNT(*) - COUNT(company_id) as prompts_without_company_id
FROM confirmed_prompts;

-- Step 2: Check if company_members has data
SELECT 
  COUNT(*) as total_memberships,
  COUNT(CASE WHEN is_default = true THEN 1 END) as default_memberships
FROM company_members;

-- Step 3: Update confirmed_prompts with company_id from user's default company
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

-- Step 4: If company_members is empty, link directly via user_onboarding
UPDATE confirmed_prompts cp
SET company_id = uo.company_id
FROM user_onboarding uo
WHERE cp.user_id = uo.user_id
  AND uo.company_id IS NOT NULL
  AND cp.company_id IS NULL;

-- Step 5: Add created_by to confirmed_prompts if missing
UPDATE confirmed_prompts 
SET created_by = user_id
WHERE created_by IS NULL 
AND user_id IS NOT NULL;

-- Step 6: Verify the fix
SELECT 
  COUNT(*) as total_prompts,
  COUNT(company_id) as prompts_with_company_id,
  COUNT(*) - COUNT(company_id) as prompts_still_without_company_id
FROM confirmed_prompts;

-- Step 7: Show sample of updated prompts
SELECT 
  cp.id,
  cp.user_id,
  cp.company_id,
  cp.prompt_type,
  cp.prompt_category,
  c.name as company_name
FROM confirmed_prompts cp
LEFT JOIN companies c ON c.id = cp.company_id
LIMIT 10;

















