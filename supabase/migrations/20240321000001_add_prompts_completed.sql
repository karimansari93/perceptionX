-- Add prompts_completed column to user_onboarding table
ALTER TABLE user_onboarding 
ADD COLUMN prompts_completed BOOLEAN DEFAULT false;

-- Update existing records to have prompts_completed = true if they have confirmed prompts
UPDATE user_onboarding uo
SET prompts_completed = true
WHERE EXISTS (
  SELECT 1 
  FROM confirmed_prompts cp 
  WHERE cp.onboarding_id = uo.id
); 