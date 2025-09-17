-- Migration: Fix TalentX constraints to allow multiple prompts per onboarding
-- This migration removes the overly restrictive constraints and creates partial unique indexes

-- 1. Drop the conflicting unique constraints
ALTER TABLE confirmed_prompts DROP CONSTRAINT IF EXISTS unique_prompt_per_onboarding;
ALTER TABLE confirmed_prompts DROP CONSTRAINT IF EXISTS unique_confirmed_prompt_type;

-- 2. Drop existing indexes that might conflict
DROP INDEX IF EXISTS idx_unique_regular_prompt_per_onboarding;
DROP INDEX IF EXISTS idx_confirmed_prompts_onboarding_type;
DROP INDEX IF EXISTS idx_confirmed_prompts_onboarding_type_unique;

-- 3. Clean up duplicate TalentX prompts before creating constraints
-- Keep only the first created prompt for each (onboarding_id, prompt_category) combination
DELETE FROM confirmed_prompts 
WHERE id NOT IN (
    SELECT DISTINCT ON (onboarding_id, prompt_category) id 
    FROM confirmed_prompts 
    WHERE is_pro_prompt = true
    ORDER BY onboarding_id, prompt_category, created_at ASC
) AND is_pro_prompt = true;

-- 4. Create partial unique indexes that only apply to regular prompts (not TalentX)
-- This allows multiple TalentX prompts per onboarding while preventing duplicates for regular prompts
CREATE UNIQUE INDEX idx_unique_regular_prompt_per_onboarding 
ON confirmed_prompts (onboarding_id, prompt_type) 
WHERE (is_pro_prompt = false OR is_pro_prompt IS NULL);

-- 5. Create a separate unique index for TalentX prompts to prevent duplicates within the same category
CREATE UNIQUE INDEX idx_unique_talentx_prompt_per_onboarding 
ON confirmed_prompts (onboarding_id, prompt_category) 
WHERE is_pro_prompt = true;

-- 6. Add comment explaining the new constraint logic
COMMENT ON INDEX idx_unique_regular_prompt_per_onboarding IS 'Prevents duplicate regular prompts per onboarding session, but allows multiple TalentX prompts';
COMMENT ON INDEX idx_unique_talentx_prompt_per_onboarding IS 'Prevents duplicate TalentX prompts of the same category per onboarding session';

-- 7. Verify the current state
DO $$
BEGIN
    RAISE NOTICE 'Migration completed. New constraint logic:';
    RAISE NOTICE '- Regular prompts: Only one per (onboarding_id, prompt_type)';
    RAISE NOTICE '- TalentX prompts: Multiple allowed per onboarding, but unique per category';
END $$;
