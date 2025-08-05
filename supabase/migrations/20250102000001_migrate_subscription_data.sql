-- Migrate existing subscription data from user_onboarding to profiles
-- This will update profiles with subscription data from the most recent user_onboarding record for each user

UPDATE profiles 
SET 
  subscription_type = (
    SELECT subscription_type 
    FROM user_onboarding 
    WHERE user_onboarding.user_id = profiles.id 
    ORDER BY created_at DESC 
    LIMIT 1
  ),
  subscription_start_date = (
    SELECT subscription_start_date 
    FROM user_onboarding 
    WHERE user_onboarding.user_id = profiles.id 
    ORDER BY created_at DESC 
    LIMIT 1
  ),
  prompts_used = (
    SELECT prompts_used 
    FROM user_onboarding 
    WHERE user_onboarding.user_id = profiles.id 
    ORDER BY created_at DESC 
    LIMIT 1
  )
WHERE EXISTS (
  SELECT 1 
  FROM user_onboarding 
  WHERE user_onboarding.user_id = profiles.id
);

-- Set default values for profiles that don't have user_onboarding records
UPDATE profiles 
SET 
  subscription_type = 'free',
  prompts_used = 0
WHERE subscription_type IS NULL; 