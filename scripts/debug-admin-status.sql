-- Debug why is_admin() is returning false
-- Run this to check your admin status

-- 1. Check your current user ID and email
SELECT 
  auth.uid() as current_user_id,
  auth.email() as current_auth_email;

-- 2. Check your profile
SELECT 
  id,
  email,
  full_name,
  created_at
FROM profiles 
WHERE id = auth.uid();

-- 3. Check what is_admin() function checks
SELECT 
  proname as function_name,
  prosrc as function_source
FROM pg_proc 
WHERE proname = 'is_admin';

-- 4. Test is_admin() directly
SELECT is_admin() as is_admin_result;

-- 5. Check if your email matches what's in is_admin()
SELECT 
  id,
  email,
  LOWER(email) as email_lower,
  CASE 
    WHEN LOWER(email) IN (
      'admin@perceptionx.com',
      'karim@perceptionx.com',
      'karim@perceptionx.ai'
    ) THEN 'MATCHES'
    ELSE 'NO MATCH'
  END as admin_email_match
FROM profiles 
WHERE id = auth.uid();

-- 6. If your email doesn't match, update is_admin() function:
/*
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND LOWER(email) IN (
      'admin@perceptionx.com',
      'karim@perceptionx.com',
      'karim@perceptionx.ai',
      'your-actual-email@here.com'  -- Add your actual email here
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
*/

