-- Remove unique constraint on confirmed_prompts to allow users full control
-- Users can now add prompts with any combination of fields without duplicate restrictions

-- Drop the unique index that prevents duplicates
DROP INDEX IF EXISTS idx_unique_regular_prompt_per_onboarding;

-- Also drop the TalentX unique index if it exists (for consistency)
DROP INDEX IF EXISTS idx_unique_talentx_prompt_per_onboarding;

-- Add comment explaining the change
COMMENT ON TABLE confirmed_prompts IS 'Prompts table - no unique constraints, users have full control over prompt creation';


