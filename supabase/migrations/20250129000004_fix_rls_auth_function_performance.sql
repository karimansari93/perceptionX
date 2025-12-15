-- ============================================================================
-- FIX: Optimize RLS Policies with auth.uid() and auth.role() Wrapping
-- ============================================================================
-- This migration fixes performance issues by wrapping auth.uid(), auth.role(),
-- and is_admin() calls in (select ...) subqueries. This allows PostgreSQL to
-- cache the result instead of re-evaluating for each row, significantly
-- improving query performance at scale.
-- ============================================================================

-- ============================================================================
-- 1. Fix profiles table: "Allow all authenticated users to read profiles"
-- ============================================================================
-- Wrap auth.role() in (select ...) to cache the result
DROP POLICY IF EXISTS "Allow all authenticated users to read profiles" ON profiles;
CREATE POLICY "Allow all authenticated users to read profiles" ON profiles
  FOR SELECT USING ((select auth.role()) = 'authenticated');

-- ============================================================================
-- 2. Fix companies table: "Owners and admins can update companies"
-- ============================================================================
-- Ensure auth.uid() is wrapped in (select ...)
DROP POLICY IF EXISTS "Owners and admins can update companies" ON companies;
CREATE POLICY "Owners and admins can update companies" ON companies
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 3. Fix organizations table: "Owners and admins can update organizations"
-- ============================================================================
-- Ensure auth.uid() is wrapped in (select ...)
DROP POLICY IF EXISTS "Owners and admins can update organizations" ON organizations;
CREATE POLICY "Owners and admins can update organizations" ON organizations
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 4. Fix company_industries table: "Owners and admins manage company industries"
-- ============================================================================
-- Ensure auth.uid() is wrapped in (select ...) for both USING and WITH CHECK
DROP POLICY IF EXISTS "Owners and admins manage company industries" ON company_industries;
CREATE POLICY "Owners and admins manage company industries" ON company_industries
  FOR ALL TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 5. Fix company_search_terms table: "Admins can view all search terms"
-- ============================================================================
-- Ensure is_admin() is wrapped in (select ...)
DROP POLICY IF EXISTS "Admins can view all search terms" ON company_search_terms;
CREATE POLICY "Admins can view all search terms" ON company_search_terms
  FOR SELECT TO authenticated
  USING ((select is_admin()));

-- ============================================================================
-- 6. Fix organization_members table: "Admins can view all org members"
-- ============================================================================
-- Ensure is_admin() is wrapped in (select ...)
DROP POLICY IF EXISTS "Admins can view all org members" ON organization_members;
CREATE POLICY "Admins can view all org members" ON organization_members
  FOR SELECT TO authenticated
  USING ((select is_admin()));











