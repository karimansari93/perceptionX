-- Migration: Apply duplicate prevention constraints
-- This migration adds unique constraints to prevent duplicate rows

-- First, clean up any existing duplicates before applying constraints
DO $$
BEGIN
    -- Clean up duplicate user_onboarding records (keep the most recent)
    DELETE FROM user_onboarding 
    WHERE id NOT IN (
        SELECT DISTINCT ON (user_id) id 
        FROM user_onboarding 
        ORDER BY user_id, created_at DESC
    );

    -- Clean up duplicate confirmed_prompts records (keep the first created)
    DELETE FROM confirmed_prompts 
    WHERE id NOT IN (
        SELECT DISTINCT ON (onboarding_id, prompt_type) id 
        FROM confirmed_prompts 
        ORDER BY onboarding_id, prompt_type, created_at ASC
    );

    -- Clean up duplicate prompt_responses records (keep the first created)
    DELETE FROM prompt_responses 
    WHERE id NOT IN (
        SELECT DISTINCT ON (confirmed_prompt_id, ai_model) id 
        FROM prompt_responses 
        ORDER BY confirmed_prompt_id, ai_model, created_at ASC
    );

    -- Clean up duplicate talentx_perception_scores records
    DELETE FROM talentx_perception_scores 
    WHERE id NOT IN (
        SELECT DISTINCT ON (user_id, attribute_id, prompt_type, ai_model) id 
        FROM talentx_perception_scores 
        ORDER BY user_id, attribute_id, prompt_type, ai_model, created_at ASC
    );
END $$;

-- Add unique constraints to prevent future duplicates
ALTER TABLE user_onboarding 
ADD CONSTRAINT unique_user_onboarding UNIQUE (user_id);

ALTER TABLE confirmed_prompts 
ADD CONSTRAINT unique_confirmed_prompt_type UNIQUE (onboarding_id, prompt_type);

ALTER TABLE prompt_responses 
ADD CONSTRAINT unique_prompt_response_model UNIQUE (confirmed_prompt_id, ai_model);

ALTER TABLE talentx_perception_scores 
ADD CONSTRAINT unique_talentx_score UNIQUE (user_id, attribute_id, prompt_type, ai_model);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_id ON user_onboarding(user_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_onboarding_type ON confirmed_prompts(onboarding_id, prompt_type);
CREATE INDEX IF NOT EXISTS idx_prompt_responses_prompt_model ON prompt_responses(confirmed_prompt_id, ai_model);
CREATE INDEX IF NOT EXISTS idx_talentx_scores_user_attribute ON talentx_perception_scores(user_id, attribute_id, prompt_type, ai_model);
