-- Migration to prevent duplicate rows in onboarding flow tables
-- This migration adds unique constraints and indexes to prevent data duplication

-- 1. Add unique constraint to user_onboarding to prevent multiple records per user
-- (Keep only the most recent one per user)
ALTER TABLE user_onboarding 
ADD CONSTRAINT unique_user_onboarding_per_user 
UNIQUE (user_id);

-- 2. Add unique constraint to confirmed_prompts to prevent duplicate prompts per onboarding session
-- (Each prompt type should only exist once per onboarding session)
ALTER TABLE confirmed_prompts 
ADD CONSTRAINT unique_prompt_per_onboarding 
UNIQUE (onboarding_id, prompt_type);

-- 3. Add unique constraint to prompt_responses to prevent duplicate responses
-- (Each prompt should only have one response per AI model)
ALTER TABLE prompt_responses 
ADD CONSTRAINT unique_response_per_prompt_model 
UNIQUE (confirmed_prompt_id, ai_model);

-- 4. Add unique constraint to talentx_pro_prompts (already exists but ensure it's enforced)
-- This constraint already exists: UNIQUE(user_id, attribute_id, prompt_type)

-- 5. Add unique constraint to talentx_perception_scores to prevent duplicate analysis
-- (Each attribute should only have one analysis per user per AI model)
ALTER TABLE talentx_perception_scores 
ADD CONSTRAINT unique_talentx_analysis 
UNIQUE (user_id, attribute_id, prompt_type, ai_model);

-- 6. Create indexes for better performance on duplicate checks
CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_id_unique 
ON user_onboarding(user_id);

CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_onboarding_type_unique 
ON confirmed_prompts(onboarding_id, prompt_type);

CREATE INDEX IF NOT EXISTS idx_prompt_responses_prompt_model_unique 
ON prompt_responses(confirmed_prompt_id, ai_model);

CREATE INDEX IF NOT EXISTS idx_talentx_scores_user_attribute_model_unique 
ON talentx_perception_scores(user_id, attribute_id, prompt_type, ai_model);

-- 7. Add function to clean up duplicate data if it exists
CREATE OR REPLACE FUNCTION cleanup_duplicate_onboarding_data()
RETURNS void AS $$
BEGIN
  -- Remove duplicate user_onboarding records, keeping the most recent
  DELETE FROM user_onboarding 
  WHERE id NOT IN (
    SELECT DISTINCT ON (user_id) id 
    FROM user_onboarding 
    ORDER BY user_id, created_at DESC
  );

  -- Remove duplicate confirmed_prompts, keeping the first created
  DELETE FROM confirmed_prompts 
  WHERE id NOT IN (
    SELECT DISTINCT ON (onboarding_id, prompt_type) id 
    FROM confirmed_prompts 
    ORDER BY onboarding_id, prompt_type, created_at ASC
  );

  -- Remove duplicate prompt_responses, keeping the first created
  DELETE FROM prompt_responses 
  WHERE id NOT IN (
    SELECT DISTINCT ON (confirmed_prompt_id, ai_model) id 
    FROM prompt_responses 
    ORDER BY confirmed_prompt_id, ai_model, created_at ASC
  );

  -- Remove duplicate talentx_perception_scores, keeping the first created
  DELETE FROM talentx_perception_scores 
  WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, attribute_id, prompt_type, ai_model) id 
    FROM talentx_perception_scores 
    ORDER BY user_id, attribute_id, prompt_type, ai_model, created_at ASC
  );
END;
$$ LANGUAGE plpgsql;

-- 8. Add comment explaining the constraints
COMMENT ON CONSTRAINT unique_user_onboarding_per_user ON user_onboarding IS 'Prevents multiple onboarding records per user';
COMMENT ON CONSTRAINT unique_prompt_per_onboarding ON confirmed_prompts IS 'Prevents duplicate prompts per onboarding session';
COMMENT ON CONSTRAINT unique_response_per_prompt_model ON prompt_responses IS 'Prevents duplicate responses per prompt and AI model';
COMMENT ON CONSTRAINT unique_talentx_analysis ON talentx_perception_scores IS 'Prevents duplicate TalentX analysis per user, attribute, and AI model';
