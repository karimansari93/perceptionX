-- Fix unique index to allow multiple industry-wide visibility prompts
-- The current index on (onboarding_id, prompt_type) prevents multiple industry-wide prompts
-- because they all have onboarding_id = NULL and prompt_type = 'visibility'
-- We need to include prompt_theme and industry_context to allow multiple prompts

-- Step 1: Drop the existing unique index
DROP INDEX IF EXISTS idx_unique_regular_prompt_per_onboarding;

-- Step 2: Clean up duplicate rows before creating the new index
-- Keep only the oldest prompt for each (onboarding_id, prompt_type, prompt_theme, industry_context) combination
-- First, reassign any prompt_responses from duplicates to the kept prompt

-- Step 2a: Reassign prompt_responses from duplicate prompts to the kept prompt
WITH duplicates_to_keep AS (
  SELECT DISTINCT ON (onboarding_id, prompt_type, prompt_theme, industry_context) 
    id as keep_id,
    onboarding_id,
    prompt_type,
    prompt_theme,
    industry_context
  FROM confirmed_prompts
  WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL)
  ORDER BY onboarding_id, prompt_type, prompt_theme, industry_context, created_at ASC
),
duplicates_to_delete AS (
  SELECT cp.id as delete_id, dk.keep_id
  FROM confirmed_prompts cp
  JOIN duplicates_to_keep dk ON 
    (cp.onboarding_id IS NULL AND dk.onboarding_id IS NULL OR cp.onboarding_id = dk.onboarding_id)
    AND cp.prompt_type = dk.prompt_type
    AND (cp.prompt_theme IS NULL AND dk.prompt_theme IS NULL OR cp.prompt_theme = dk.prompt_theme)
    AND (cp.industry_context IS NULL AND dk.industry_context IS NULL OR cp.industry_context = dk.industry_context)
  WHERE cp.id != dk.keep_id
    AND (cp.is_pro_prompt = false OR cp.is_pro_prompt IS NULL)
)
UPDATE prompt_responses pr
SET confirmed_prompt_id = dtd.keep_id
FROM duplicates_to_delete dtd
WHERE pr.confirmed_prompt_id = dtd.delete_id;

-- Step 2b: Now delete the duplicate prompts (responses have been reassigned)
WITH duplicates_to_keep AS (
  SELECT DISTINCT ON (onboarding_id, prompt_type, prompt_theme, industry_context) id
  FROM confirmed_prompts
  WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL)
  ORDER BY onboarding_id, prompt_type, prompt_theme, industry_context, created_at ASC
)
DELETE FROM confirmed_prompts
WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL)
  AND id NOT IN (SELECT id FROM duplicates_to_keep);

-- Step 3: Create a new unique index that includes prompt_theme and industry_context
-- This allows multiple industry-wide prompts (onboarding_id = NULL) with different themes/industries
-- while still preventing duplicates for regular prompts (onboarding_id IS NOT NULL)
-- Note: NULL values are considered distinct in unique indexes, so multiple rows with onboarding_id = NULL
-- are allowed as long as they differ in prompt_type, prompt_theme, or industry_context
CREATE UNIQUE INDEX idx_unique_regular_prompt_per_onboarding 
ON confirmed_prompts (onboarding_id, prompt_type, prompt_theme, industry_context) 
WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL);

-- Step 4: Add comment explaining the updated constraint
COMMENT ON INDEX idx_unique_regular_prompt_per_onboarding IS 
'Prevents duplicate regular prompts per onboarding session, but allows multiple industry-wide prompts with different themes and industries. Includes prompt_theme and industry_context to support industry-wide visibility rankings.';

