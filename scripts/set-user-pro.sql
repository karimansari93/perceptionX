-- Script to manually set a user to pro subscription status
-- Replace 'YOUR_USER_ID' with your actual user ID

-- First, make sure the subscription fields exist
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS subscription_type subscription_type DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS prompts_used INTEGER DEFAULT 0;

-- Update your user to pro subscription
-- Replace 'YOUR_USER_ID' with your actual user ID from the auth.users table
UPDATE profiles 
SET 
  subscription_type = 'pro',
  subscription_start_date = NOW(),
  prompts_used = 0
WHERE id = 'YOUR_USER_ID'; -- Replace with your actual user ID

-- Verify the update
SELECT 
  id, 
  email, 
  subscription_type, 
  subscription_start_date, 
  prompts_used 
FROM profiles 
WHERE id = 'YOUR_USER_ID'; -- Replace with your actual user ID 