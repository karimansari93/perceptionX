-- Add industry context to confirmed prompts to support multiple industries per prompt type
ALTER TABLE confirmed_prompts
  ADD COLUMN IF NOT EXISTS industry_context TEXT;

COMMENT ON COLUMN confirmed_prompts.industry_context IS 'Industry context for the prompt (used to allow multiple variants per prompt type).';

-- Populate the new column using existing company and onboarding data
UPDATE confirmed_prompts cp
SET industry_context = COALESCE(cp.industry_context, c.industry)
FROM companies c
WHERE cp.company_id = c.id
  AND cp.industry_context IS NULL;

UPDATE confirmed_prompts cp
SET industry_context = COALESCE(cp.industry_context, uo.industry)
FROM user_onboarding uo
WHERE cp.onboarding_id = uo.id
  AND cp.industry_context IS NULL;

-- Normalize formatting to prevent accidental duplicates caused purely by whitespace
UPDATE confirmed_prompts
SET industry_context = TRIM(industry_context)
WHERE industry_context IS NOT NULL;

-- Remove the strict uniqueness constraint so multiple prompts per type can coexist
DROP INDEX IF EXISTS idx_unique_regular_prompt_per_onboarding;

