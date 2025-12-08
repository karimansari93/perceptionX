-- Fix RLS policies for visibility_rankings table
-- Run this if you're getting 406 errors when querying the table

-- 1. Check current RLS status
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'visibility_rankings';

-- 2. Check existing policies
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'visibility_rankings';

-- 3. Drop existing policies (if they exist and need to be recreated)
DROP POLICY IF EXISTS "Admins can view all visibility rankings" ON visibility_rankings;
DROP POLICY IF EXISTS "Admins can insert visibility rankings" ON visibility_rankings;
DROP POLICY IF EXISTS "Admins can update visibility rankings" ON visibility_rankings;
DROP POLICY IF EXISTS "Users can view rankings for their companies" ON visibility_rankings;

-- 4. Ensure RLS is enabled
ALTER TABLE visibility_rankings ENABLE ROW LEVEL SECURITY;

-- 5. Create admin policies (using is_admin() function)
CREATE POLICY "Admins can view all visibility rankings" ON visibility_rankings
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can insert visibility rankings" ON visibility_rankings
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can update visibility rankings" ON visibility_rankings
  FOR UPDATE USING (is_admin());

-- 6. Create user policy (users can view rankings for their companies)
CREATE POLICY "Users can view rankings for their companies" ON visibility_rankings
  FOR SELECT USING (
    company_id IN (
      SELECT company_id
      FROM company_members
      WHERE user_id = auth.uid()
    )
  );

-- 7. Test: Check if you can query the table
-- This should work if you're logged in as admin
SELECT COUNT(*) as test_count FROM visibility_rankings;

-- 8. Verify is_admin() function exists and works
SELECT is_admin() as is_admin_result;

-- 9. Check your current user email
SELECT 
  id,
  email,
  is_admin() as is_admin
FROM profiles 
WHERE id = auth.uid();

