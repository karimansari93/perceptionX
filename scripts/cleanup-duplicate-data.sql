-- Script to clean up duplicate data before applying unique constraints
-- Run this script BEFORE running the migration to prevent duplicate rows

-- 1. Clean up duplicate user_onboarding records
-- Keep only the most recent record per user
DELETE FROM user_onboarding 
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id) id 
  FROM user_onboarding 
  ORDER BY user_id, created_at DESC
);

-- 2. Clean up duplicate confirmed_prompts
-- Keep only the first created prompt per onboarding session and type
DELETE FROM confirmed_prompts 
WHERE id NOT IN (
  SELECT DISTINCT ON (onboarding_id, prompt_type) id 
  FROM confirmed_prompts 
  ORDER BY onboarding_id, prompt_type, created_at ASC
);

-- 3. Clean up duplicate prompt_responses
-- Keep only the first created response per prompt and AI model
DELETE FROM prompt_responses 
WHERE id NOT IN (
  SELECT DISTINCT ON (confirmed_prompt_id, ai_model) id 
  FROM prompt_responses 
  ORDER BY confirmed_prompt_id, ai_model, created_at ASC
);

-- 4. Clean up duplicate talentx_perception_scores
-- Keep only the first created score per user, attribute, and AI model
DELETE FROM talentx_perception_scores 
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, attribute_id, prompt_type, ai_model) id 
  FROM talentx_perception_scores 
  ORDER BY user_id, attribute_id, prompt_type, ai_model, created_at ASC
);

-- 5. Verify cleanup results
SELECT 
  'user_onboarding' as table_name,
  COUNT(*) as total_records,
  COUNT(DISTINCT user_id) as unique_users
FROM user_onboarding
UNION ALL
SELECT 
  'confirmed_prompts' as table_name,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(onboarding_id, ':', prompt_type)) as unique_prompt_types
FROM confirmed_prompts
UNION ALL
SELECT 
  'prompt_responses' as table_name,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(confirmed_prompt_id, ':', ai_model)) as unique_prompt_models
FROM prompt_responses
UNION ALL
SELECT 
  'talentx_perception_scores' as table_name,
  COUNT(*) as total_records,
  COUNT(DISTINCT CONCAT(user_id, ':', attribute_id, ':', prompt_type, ':', ai_model)) as unique_analyses
FROM talentx_perception_scores;

-- 6. Show any remaining duplicates (should be 0 after cleanup)
SELECT 'user_onboarding duplicates' as check_type, COUNT(*) as duplicate_count
FROM (
  SELECT user_id, COUNT(*) 
  FROM user_onboarding 
  GROUP BY user_id 
  HAVING COUNT(*) > 1
) dups
UNION ALL
SELECT 'confirmed_prompts duplicates', COUNT(*) 
FROM (
  SELECT onboarding_id, prompt_type, COUNT(*) 
  FROM confirmed_prompts 
  GROUP BY onboarding_id, prompt_type 
  HAVING COUNT(*) > 1
) dups
UNION ALL
SELECT 'prompt_responses duplicates', COUNT(*) 
FROM (
  SELECT confirmed_prompt_id, ai_model, COUNT(*) 
  FROM prompt_responses 
  GROUP BY confirmed_prompt_id, ai_model 
  HAVING COUNT(*) > 1
) dups
UNION ALL
SELECT 'talentx_perception_scores duplicates', COUNT(*) 
FROM (
  SELECT user_id, attribute_id, prompt_type, ai_model, COUNT(*) 
  FROM talentx_perception_scores 
  GROUP BY user_id, attribute_id, prompt_type, ai_model 
  HAVING COUNT(*) > 1
) dups;
