-- Add prompt_theme field and align prompt_category values
ALTER TABLE confirmed_prompts
  ADD COLUMN IF NOT EXISTS prompt_theme TEXT;

COMMENT ON COLUMN confirmed_prompts.prompt_category IS 'High-level experience segment: General, Employee Experience, or Candidate Experience.';
COMMENT ON COLUMN confirmed_prompts.prompt_theme IS 'Specific theme within the experience category (e.g., Purpose, Compensation, Interview Experience).';

-- 1. Existing TalentX prompts -> Employee Experience group
UPDATE confirmed_prompts
SET prompt_theme = TRIM(BOTH ' ' FROM REPLACE(prompt_category, 'TalentX:', '')),
    prompt_category = 'Employee Experience'
WHERE prompt_category LIKE 'TalentX:%';

-- 2. Candidate experience prompts -> Candidate Experience group with updated themes
UPDATE confirmed_prompts
SET prompt_theme = CASE prompt_category
    WHEN 'Communication' THEN 'Candidate Communication'
    WHEN 'Interview' THEN 'Interview Experience'
    WHEN 'Application Process' THEN 'Application Process'
    WHEN 'Onboarding' THEN 'Onboarding Experience'
    WHEN 'Feedback' THEN 'Candidate Feedback'
    WHEN 'Overall Experience' THEN 'Overall Candidate Experience'
    ELSE prompt_theme
  END,
    prompt_category = 'Candidate Experience'
WHERE prompt_category IN (
  'Application Process',
  'Communication',
  'Interview',
  'Feedback',
  'Onboarding',
  'Overall Experience'
);

-- 3. Baseline prompts -> General group
UPDATE confirmed_prompts
SET prompt_category = 'General',
    prompt_theme = 'General'
WHERE prompt_category IS NULL OR prompt_category IN (
  'Employer Reputation',
  'Industry Visibility',
  'Competitive Analysis'
);

-- Ensure every prompt has a theme value
UPDATE confirmed_prompts
SET prompt_theme = COALESCE(prompt_theme, 'General');


