-- Fix admin access for visibility_rankings
-- This will help debug why is_admin() returns false and fix it

-- 1. Check your current user email
SELECT 
  id,
  email,
  LOWER(email) as email_lower
FROM profiles 
WHERE id = auth.uid();

-- 2. Check what emails are in is_admin() function
SELECT 
  proname,
  prosrc
FROM pg_proc 
WHERE proname = 'is_admin';

-- 3. Update is_admin() to include your email (replace with your actual email)
-- First, check what your email is from step 1, then update the function:

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if the current user's email is in the admin list
  -- SECURITY DEFINER allows this function to bypass RLS when checking profiles
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND LOWER(email) IN (
      'admin@perceptionx.com',
      'karim@perceptionx.com',
      'karim@perceptionx.ai',
      'karim@perceptionx.ai'  -- Make sure this matches your actual email
      -- Add your actual email here if it's different
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Test is_admin() again
SELECT is_admin() as is_admin_result;

-- 5. If still false, you can temporarily allow all authenticated users (for testing only):
/*
-- TEMPORARY: Allow all authenticated users to view rankings (remove this later!)
DROP POLICY IF EXISTS "Allow all authenticated users to view rankings" ON visibility_rankings;
CREATE POLICY "Allow all authenticated users to view rankings" ON visibility_rankings
  FOR SELECT USING (auth.role() = 'authenticated');
*/

-- 6. Or update your profile email to match:
/*
UPDATE profiles 
SET email = 'karim@perceptionx.ai'  -- Use the email from is_admin() list
WHERE id = auth.uid();
*/

