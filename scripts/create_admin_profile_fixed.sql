-- Create admin profile for karim@perceptionx.ai using actual user ID
-- Run this in your Supabase SQL Editor

-- Use your actual user ID from the error logs
INSERT INTO profiles (id, email, full_name, created_at, updated_at, subscription_type)
VALUES (
  '95271cff-03ee-4b39-9632-70ed3b141d88', 
  'karim@perceptionx.ai', 
  'Admin User',
  NOW(),
  NOW(),
  'pro'
)
ON CONFLICT (id) 
DO UPDATE SET 
  email = 'karim@perceptionx.ai',
  full_name = 'Admin User',
  subscription_type = 'pro',
  updated_at = NOW();

-- Verify the profile was created/updated
SELECT id, email, full_name, subscription_type, created_at 
FROM profiles 
WHERE id = '95271cff-03ee-4b39-9632-70ed3b141d88';

-- Test the is_admin function (this will still return false because we're not authenticated)
-- But the profile should now exist
SELECT 
  '95271cff-03ee-4b39-9632-70ed3b141d88' as user_id,
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = '95271cff-03ee-4b39-9632-70ed3b141d88'
  ) as profile_exists,
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = '95271cff-03ee-4b39-9632-70ed3b141d88'
    AND email = 'karim@perceptionx.ai'
  ) as has_correct_email;
















