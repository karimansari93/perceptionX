-- Check if visibility_rankings table exists and RLS is configured
-- Run this to diagnose the 406 error

-- 1. Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'visibility_rankings'
) as table_exists;

-- 2. Check RLS status
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'visibility_rankings';

-- 3. Check existing policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'visibility_rankings';

-- 4. Check if is_admin() function exists
SELECT EXISTS (
  SELECT FROM pg_proc 
  WHERE proname = 'is_admin'
) as is_admin_function_exists;

-- 5. Try to select from table (this will show the actual error)
SELECT COUNT(*) as total_rankings FROM visibility_rankings;

-- 6. If table doesn't exist, you need to run the migration:
-- supabase/migrations/20250126000000_create_visibility_rankings.sql

-- 7. If RLS policies don't exist, run this:
/*
ALTER TABLE visibility_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all visibility rankings" ON visibility_rankings
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can insert visibility rankings" ON visibility_rankings
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can update visibility rankings" ON visibility_rankings
  FOR UPDATE USING (is_admin());

CREATE POLICY "Users can view rankings for their companies" ON visibility_rankings
  FOR SELECT USING (
    company_id IN (
      SELECT company_id
      FROM company_members
      WHERE user_id = auth.uid()
    )
  );
*/

