-- Debug script to investigate why only 6 visibility prompts were created
-- Expected: 10 Employee Experience + 6 Candidate Experience = 16 total prompts

-- 1. Count visibility prompts by category and theme for Aerospace industry
SELECT 
  prompt_category,
  prompt_theme,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as prompt_ids
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND industry_context = 'Aerospace'
  AND company_id IS NULL
  AND onboarding_id IS NULL
GROUP BY prompt_category, prompt_theme
ORDER BY prompt_category, prompt_theme;

-- 2. Show all visibility prompts for Aerospace with full details
SELECT 
  id,
  prompt_category,
  prompt_theme,
  prompt_text,
  industry_context,
  location_context,
  job_function_context,
  company_id,
  onboarding_id,
  created_at
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND industry_context = 'Aerospace'
  AND company_id IS NULL
  AND onboarding_id IS NULL
ORDER BY prompt_category, prompt_theme, created_at;

-- 3. Check for any unique constraint violations or issues
-- List all unique indexes on confirmed_prompts
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'confirmed_prompts'
  AND indexdef LIKE '%UNIQUE%';

-- 4. Check if there are prompts with different location_context that might be interfering
SELECT 
  prompt_category,
  prompt_theme,
  location_context,
  COUNT(*) as count
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND industry_context = 'Aerospace'
  AND company_id IS NULL
  AND onboarding_id IS NULL
GROUP BY prompt_category, prompt_theme, location_context
ORDER BY prompt_category, prompt_theme, location_context;

-- 5. Expected themes for Employee Experience (should be 10):
-- Mission & Purpose, Rewards & Recognition, Company Culture, Social Impact, 
-- Inclusion, Innovation, Wellbeing & Balance, Leadership, Security & Perks, Career Opportunities
-- Check which ones are missing:
SELECT 
  'Employee Experience' as category,
  'Mission & Purpose' as expected_theme, 
  EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Mission & Purpose' AND company_id IS NULL AND location_context IS NULL) as exists
UNION ALL
SELECT 'Employee Experience', 'Rewards & Recognition', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Rewards & Recognition' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Company Culture', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Company Culture' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Social Impact', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Social Impact' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Inclusion', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Inclusion' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Innovation', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Innovation' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Wellbeing & Balance', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Wellbeing & Balance' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Leadership', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Leadership' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Security & Perks', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Security & Perks' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Employee Experience', 'Career Opportunities', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Employee Experience' AND prompt_theme = 'Career Opportunities' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
-- Expected themes for Candidate Experience (should be 6):
-- Application Process, Candidate Communication, Interview Experience,
-- Candidate Feedback, Onboarding Experience, Overall Candidate Experience
SELECT 'Candidate Experience', 'Application Process', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Candidate Experience' AND prompt_theme = 'Application Process' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Candidate Experience', 'Candidate Communication', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Candidate Experience' AND prompt_theme = 'Candidate Communication' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Candidate Experience', 'Interview Experience', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Candidate Experience' AND prompt_theme = 'Interview Experience' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Candidate Experience', 'Candidate Feedback', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Candidate Experience' AND prompt_theme = 'Candidate Feedback' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Candidate Experience', 'Onboarding Experience', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Candidate Experience' AND prompt_theme = 'Onboarding Experience' AND company_id IS NULL AND location_context IS NULL)
UNION ALL
SELECT 'Candidate Experience', 'Overall Candidate Experience', EXISTS(SELECT 1 FROM confirmed_prompts WHERE prompt_type = 'visibility' AND industry_context = 'Aerospace' AND prompt_category = 'Candidate Experience' AND prompt_theme = 'Overall Candidate Experience' AND company_id IS NULL AND location_context IS NULL)
ORDER BY category, expected_theme;

