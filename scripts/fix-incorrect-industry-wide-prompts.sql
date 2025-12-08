-- Fix incorrectly created industry-wide visibility prompts
-- These prompts should have company_id = NULL but were auto-assigned a company_id by the trigger

-- Step 1: Identify industry-wide visibility prompts that incorrectly have a company_id
-- These are prompts with:
-- - prompt_type = 'visibility'
-- - onboarding_id IS NULL (industry-wide prompts don't have onboarding_id)
-- - company_id IS NOT NULL (incorrectly set by trigger)

SELECT 
  COUNT(*) as incorrectly_linked_prompts,
  COUNT(DISTINCT company_id) as affected_companies
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
  AND company_id IS NOT NULL;

-- Step 2: Fix them by setting company_id to NULL
UPDATE confirmed_prompts
SET company_id = NULL
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
  AND company_id IS NOT NULL;

-- Step 3: Verify the fix
SELECT 
  COUNT(*) as total_industry_wide_prompts,
  COUNT(CASE WHEN company_id IS NULL THEN 1 END) as correctly_null,
  COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as still_incorrect
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL;

-- Step 4: Show sample of fixed prompts
SELECT 
  id,
  prompt_theme,
  prompt_category,
  industry_context,
  company_id,
  created_at
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
ORDER BY created_at DESC
LIMIT 10;

