-- Fix industry-wide visibility prompts and responses that incorrectly have company_id
-- Industry-wide prompts should have company_id = NULL (they're not tied to specific companies)
-- Their responses should also have company_id = NULL

-- Step 1: Check current state
SELECT 
  'Industry-wide prompts with company_id' as check_type,
  COUNT(*) as count
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
  AND company_id IS NOT NULL;

SELECT 
  'Industry-wide responses with company_id' as check_type,
  COUNT(*) as count
FROM prompt_responses pr
INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE cp.prompt_type = 'visibility'
  AND cp.onboarding_id IS NULL
  AND pr.company_id IS NOT NULL;

-- Step 2: Fix confirmed_prompts - set company_id to NULL for industry-wide prompts
UPDATE confirmed_prompts
SET company_id = NULL
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
  AND company_id IS NOT NULL;

-- Step 3: Fix prompt_responses - set company_id to NULL for responses linked to industry-wide prompts
UPDATE prompt_responses pr
SET company_id = NULL
FROM confirmed_prompts cp
WHERE pr.confirmed_prompt_id = cp.id
  AND cp.prompt_type = 'visibility'
  AND cp.onboarding_id IS NULL
  AND pr.company_id IS NOT NULL;

-- Step 4: Verify the fix
SELECT 
  'Industry-wide prompts (should all be NULL)' as check_type,
  COUNT(*) as total,
  COUNT(CASE WHEN company_id IS NULL THEN 1 END) as correctly_null,
  COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as still_incorrect
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL;

SELECT 
  'Industry-wide responses (should all be NULL)' as check_type,
  COUNT(*) as total,
  COUNT(CASE WHEN pr.company_id IS NULL THEN 1 END) as correctly_null,
  COUNT(CASE WHEN pr.company_id IS NOT NULL THEN 1 END) as still_incorrect
FROM prompt_responses pr
INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE cp.prompt_type = 'visibility'
  AND cp.onboarding_id IS NULL;

-- Step 5: Show sample of fixed data
SELECT 
  'Sample fixed prompts' as info,
  cp.id,
  cp.prompt_theme,
  cp.prompt_category,
  cp.industry_context,
  cp.company_id,
  cp.created_at
FROM confirmed_prompts cp
WHERE cp.prompt_type = 'visibility'
  AND cp.onboarding_id IS NULL
ORDER BY cp.created_at DESC
LIMIT 10;

SELECT 
  'Sample fixed responses' as info,
  pr.id,
  pr.confirmed_prompt_id,
  pr.company_id,
  pr.ai_model,
  pr.tested_at
FROM prompt_responses pr
INNER JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE cp.prompt_type = 'visibility'
  AND cp.onboarding_id IS NULL
ORDER BY pr.tested_at DESC
LIMIT 10;










