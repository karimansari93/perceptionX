-- Migration script to add subscription fields to profiles table
-- Run this in your Supabase SQL Editor

-- Add subscription fields to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS subscription_type subscription_type DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS prompts_used INTEGER DEFAULT 0;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_type 
ON profiles(subscription_type);

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_profiles_id 
ON profiles(id);

-- Add trigger for updated_at (if the function doesn't exist, create it first)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing subscription data from user_onboarding to profiles
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

-- Verify the changes
SELECT 
  id, 
  email, 
  subscription_type, 
  subscription_start_date, 
  prompts_used 
FROM profiles 
LIMIT 10; 