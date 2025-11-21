-- Create admin profile for karim@perceptionx.ai
-- Run this in your Supabase SQL Editor

-- First, let's see what user ID you're currently using
SELECT auth.uid() as current_user_id;

-- Create a profile for the current user with admin email
INSERT INTO profiles (id, email, full_name, created_at, updated_at)
VALUES (
  auth.uid(), 
  'karim@perceptionx.ai', 
  'Admin User',
  NOW(),
  NOW()
)
ON CONFLICT (id) 
DO UPDATE SET 
  email = 'karim@perceptionx.ai',
  full_name = 'Admin User',
  updated_at = NOW();

-- Verify the profile was created/updated
SELECT id, email, full_name, created_at 
FROM profiles 
WHERE id = auth.uid();

-- Test the is_admin function
SELECT is_admin() as is_admin_result;
















