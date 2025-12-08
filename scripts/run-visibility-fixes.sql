-- Combined migration to fix industry-wide visibility prompts
-- Run this in your Supabase SQL Editor

-- ============================================================================
-- MIGRATION 1: Fix auto_link_prompts_trigger to skip industry-wide visibility prompts
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_link_prompts_to_company()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Skip auto-linking for industry-wide visibility prompts
  -- These are prompts with prompt_type = 'visibility' and no onboarding_id
  -- They are meant to be industry-wide (company_id = NULL) for visibility rankings
  IF NEW.prompt_type = 'visibility' AND NEW.onboarding_id IS NULL THEN
    -- This is an industry-wide visibility prompt, keep company_id as NULL
    RETURN NEW;
  END IF;

  -- Find the user's default company
  SELECT cm.company_id INTO v_company_id
  FROM company_members cm
  WHERE cm.user_id = NEW.user_id 
    AND cm.is_default = true
  LIMIT 1;
  
  -- If no default, get latest company
  IF v_company_id IS NULL THEN
    SELECT cm.company_id INTO v_company_id
    FROM company_members cm
    WHERE cm.user_id = NEW.user_id
    ORDER BY cm.joined_at DESC
    LIMIT 1;
  END IF;
  
  -- Set the company_id
  IF v_company_id IS NOT NULL THEN
    NEW.company_id := v_company_id;
    NEW.created_by := NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION 2: Fix existing data - set company_id to NULL for industry-wide prompts/responses
-- ============================================================================

-- Step 1: Fix confirmed_prompts - set company_id to NULL for industry-wide prompts
UPDATE confirmed_prompts
SET company_id = NULL
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
  AND company_id IS NOT NULL;

-- Step 2: Fix prompt_responses - set company_id to NULL for responses linked to industry-wide prompts
UPDATE prompt_responses pr
SET company_id = NULL
FROM confirmed_prompts cp
WHERE pr.confirmed_prompt_id = cp.id
  AND cp.prompt_type = 'visibility'
  AND cp.onboarding_id IS NULL
  AND pr.company_id IS NOT NULL;

-- ============================================================================
-- MIGRATION 3: Fix unique index to allow multiple industry-wide visibility prompts
-- ============================================================================

-- Step 1: Drop any existing constraints and indexes that might interfere
DROP INDEX IF EXISTS idx_unique_regular_prompt_per_onboarding;
ALTER TABLE confirmed_prompts DROP CONSTRAINT IF EXISTS unique_prompt_per_onboarding;
ALTER TABLE confirmed_prompts DROP CONSTRAINT IF EXISTS unique_confirmed_prompt_type;

-- Step 2: Clean up duplicate rows before creating the new index
-- Step 2a: Reassign prompt_responses from duplicate prompts to the kept prompt
-- IMPORTANT: Must include prompt_category in the unique constraint to allow Employee Experience and Candidate Experience prompts with same theme
WITH duplicates_to_keep AS (
  SELECT DISTINCT ON (onboarding_id, prompt_type, prompt_category, prompt_theme, industry_context) 
    id as keep_id,
    onboarding_id,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context
  FROM confirmed_prompts
  WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL)
  ORDER BY onboarding_id, prompt_type, prompt_category, prompt_theme, industry_context, created_at ASC
),
duplicates_to_delete AS (
  SELECT cp.id as delete_id, dk.keep_id
  FROM confirmed_prompts cp
  JOIN duplicates_to_keep dk ON 
    (cp.onboarding_id IS NULL AND dk.onboarding_id IS NULL OR cp.onboarding_id = dk.onboarding_id)
    AND cp.prompt_type = dk.prompt_type
    AND (cp.prompt_category IS NULL AND dk.prompt_category IS NULL OR cp.prompt_category = dk.prompt_category)
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
  SELECT DISTINCT ON (onboarding_id, prompt_type, prompt_category, prompt_theme, industry_context) id
  FROM confirmed_prompts
  WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL)
  ORDER BY onboarding_id, prompt_type, prompt_category, prompt_theme, industry_context, created_at ASC
)
DELETE FROM confirmed_prompts
WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL)
  AND id NOT IN (SELECT id FROM duplicates_to_keep);

-- Step 3: Create a new unique index that includes prompt_category, prompt_theme, and industry_context
-- CRITICAL: Must include prompt_category to allow Employee Experience and Candidate Experience prompts
-- with the same theme name (though currently they have different themes, this ensures correctness)
CREATE UNIQUE INDEX idx_unique_regular_prompt_per_onboarding 
ON confirmed_prompts (onboarding_id, prompt_type, prompt_category, prompt_theme, industry_context) 
WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL);

-- Step 4: Add comment explaining the updated constraint
COMMENT ON INDEX idx_unique_regular_prompt_per_onboarding IS 
'Prevents duplicate regular prompts per onboarding session, but allows multiple industry-wide prompts with different categories, themes and industries. Includes prompt_category, prompt_theme and industry_context to support industry-wide visibility rankings (16 prompts: 10 Employee Experience + 6 Candidate Experience).';

-- ============================================================================
-- Done! The migrations are complete.
-- 
-- What was fixed:
-- 1. Trigger now skips setting company_id for industry-wide visibility prompts
-- 2. Existing industry-wide prompts and responses have company_id set to NULL
-- 3. Unique index now allows multiple industry-wide prompts with different themes/industries
-- ============================================================================

