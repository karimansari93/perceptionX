-- Create missing visibility prompts for Aerospace industry
-- This script creates any missing Employee Experience (10 total) and Candidate Experience (6 total) prompts
-- Total expected: 16 prompts per industry

-- First, get the admin user ID (or use the first user)
DO $$
DECLARE
  v_admin_user_id UUID;
  v_industry TEXT := 'Aerospace';
  v_country TEXT := 'US';
  v_location TEXT := ' in ' || v_country;
BEGIN
  -- Get the first user (or admin user if exists)
  SELECT id INTO v_admin_user_id
  FROM profiles
  LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found to associate prompts with';
  END IF;

  RAISE NOTICE 'Using user ID: %', v_admin_user_id;
  RAISE NOTICE 'Creating visibility prompts for industry: %', v_industry;

  -- ============================================================================
  -- EMPLOYEE EXPERIENCE PROMPTS (10 total)
  -- ============================================================================

  -- 1. Wellbeing & Balance
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' are recognized for exceptional employee wellbeing and work-life balance?',
    'visibility',
    'Employee Experience',
    'Wellbeing & Balance',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Employee Experience'
      AND prompt_theme = 'Wellbeing & Balance'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 2. Leadership
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' are respected for outstanding leadership and management?',
    'visibility',
    'Employee Experience',
    'Leadership',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Employee Experience'
      AND prompt_theme = 'Leadership'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 3. Security & Perks
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' are known for providing comprehensive benefits and job security?',
    'visibility',
    'Employee Experience',
    'Security & Perks',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Employee Experience'
      AND prompt_theme = 'Security & Perks'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 4. Career Opportunities
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' are most recognized for exceptional career development and progression opportunities?',
    'visibility',
    'Employee Experience',
    'Career Opportunities',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Employee Experience'
      AND prompt_theme = 'Career Opportunities'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- ============================================================================
  -- CANDIDATE EXPERIENCE PROMPTS (6 total)
  -- ============================================================================

  -- 1. Application Process
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' have the best application process?',
    'visibility',
    'Candidate Experience',
    'Application Process',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Candidate Experience'
      AND prompt_theme = 'Application Process'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 2. Candidate Communication
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' are recognized for strong candidate communication?',
    'visibility',
    'Candidate Experience',
    'Candidate Communication',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Candidate Experience'
      AND prompt_theme = 'Candidate Communication'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 3. Interview Experience
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' have the best interview experience?',
    'visibility',
    'Candidate Experience',
    'Interview Experience',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Candidate Experience'
      AND prompt_theme = 'Interview Experience'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 4. Candidate Feedback
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' are known for providing valuable candidate feedback?',
    'visibility',
    'Candidate Experience',
    'Candidate Feedback',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Candidate Experience'
      AND prompt_theme = 'Candidate Feedback'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 5. Onboarding Experience
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' have the best onboarding experience?',
    'visibility',
    'Candidate Experience',
    'Onboarding Experience',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Candidate Experience'
      AND prompt_theme = 'Onboarding Experience'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  -- 6. Overall Candidate Experience
  INSERT INTO confirmed_prompts (
    user_id,
    company_id,
    onboarding_id,
    prompt_text,
    prompt_type,
    prompt_category,
    prompt_theme,
    industry_context,
    location_context
  )
  SELECT 
    v_admin_user_id,
    NULL,
    NULL,
    'What companies in ' || v_industry || v_location || ' have the best overall candidate reputation?',
    'visibility',
    'Candidate Experience',
    'Overall Candidate Experience',
    v_industry,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM confirmed_prompts
    WHERE prompt_type = 'visibility'
      AND prompt_category = 'Candidate Experience'
      AND prompt_theme = 'Overall Candidate Experience'
      AND industry_context = v_industry
      AND company_id IS NULL
      AND location_context IS NULL
  );

  RAISE NOTICE 'Finished creating missing visibility prompts for % industry', v_industry;
END $$;

-- Verify all prompts were created
SELECT 
  prompt_category,
  prompt_theme,
  prompt_text,
  created_at
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND industry_context = 'Aerospace'
  AND company_id IS NULL
  AND location_context IS NULL
ORDER BY prompt_category, prompt_theme;

-- Summary count
SELECT 
  prompt_category,
  COUNT(*) as prompt_count,
  CASE 
    WHEN prompt_category = 'Employee Experience' THEN 'Expected: 10'
    WHEN prompt_category = 'Candidate Experience' THEN 'Expected: 6'
    ELSE 'Unknown'
  END as expected_count
FROM confirmed_prompts
WHERE prompt_type = 'visibility'
  AND industry_context = 'Aerospace'
  AND company_id IS NULL
  AND location_context IS NULL
GROUP BY prompt_category
ORDER BY prompt_category;


