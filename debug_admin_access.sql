-- Debug admin access
-- Run this in your Supabase SQL Editor

-- Check what's in the profiles table
SELECT id, email, created_at 
FROM profiles 
ORDER BY created_at DESC 
LIMIT 10;

-- Check if your specific user ID exists in profiles
SELECT id, email, created_at 
FROM profiles 
WHERE id = '95271cff-03ee-4b39-9632-70ed3b141d88';

-- Check what the current auth.uid() returns
SELECT auth.uid() as current_user_id;

-- Check if there are any profiles with similar emails
SELECT id, email, created_at 
FROM profiles 
WHERE email LIKE '%karim%' OR email LIKE '%perceptionx%';

-- Test the is_admin function step by step
SELECT 
  auth.uid() as user_id,
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid()
  ) as profile_exists,
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND email = 'karim@perceptionx.ai'
  ) as has_correct_email;
















