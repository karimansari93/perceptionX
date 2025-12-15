-- Verify that all 16 prompts can be created for an industry
-- Run this AFTER running run-visibility-fixes.sql

-- Check current unique index definition
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'confirmed_prompts'
  AND indexname = 'idx_unique_regular_prompt_per_onboarding';

-- Check if there are any other unique constraints on confirmed_prompts
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'confirmed_prompts'::regclass
  AND contype = 'u';

-- Test: Count industry-wide visibility prompts by category and theme
-- Should show 10 Employee Experience + 6 Candidate Experience = 16 total
SELECT 
  prompt_category,
  prompt_theme,
  industry_context,
  COUNT(*) as count
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
GROUP BY prompt_category, prompt_theme, industry_context
ORDER BY prompt_category, prompt_theme;

-- Show all industry-wide visibility prompts
SELECT 
  id,
  prompt_category,
  prompt_theme,
  industry_context,
  company_id,
  onboarding_id,
  created_at
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND onboarding_id IS NULL
ORDER BY prompt_category, prompt_theme, industry_context;

-- Expected themes:
-- Employee Experience (10): Mission & Purpose, Rewards & Recognition, Company Culture, 
--   Social Impact, Inclusion, Innovation, Wellbeing & Balance, Leadership, Security & Perks, Career Opportunities
-- Candidate Experience (6): Application Process, Candidate Communication, Interview Experience,
--   Candidate Feedback, Onboarding Experience, Overall Candidate Experience











