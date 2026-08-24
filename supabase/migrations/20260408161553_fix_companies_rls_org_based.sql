-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260408161553; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- ============================================================================
-- FIX: Update companies-related RLS policies to use organization membership
-- ============================================================================

-- ============================================================
-- A. Fix companies table policies
-- ============================================================

-- SELECT: Users can only see companies in their organization
DROP POLICY IF EXISTS "Users can view their companies" ON companies;
CREATE POLICY "Users can view their companies" ON companies
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

-- UPDATE: Only org owners/admins can update companies
DROP POLICY IF EXISTS "Owners and admins can update companies" ON companies;
CREATE POLICY "Owners and admins can update companies" ON companies
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
      AND om.role IN ('owner', 'admin')
    )
  );

-- DELETE: Only org owners can delete companies
DROP POLICY IF EXISTS "Owners can delete companies" ON companies;
CREATE POLICY "Owners can delete companies" ON companies
  FOR DELETE TO authenticated
  USING (
    id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
      AND om.role = 'owner'
    )
  );

-- ============================================================
-- B. Fix company_industries table policies
-- ============================================================

DROP POLICY IF EXISTS "Members can view company industries" ON company_industries;
CREATE POLICY "Members can view company industries" ON company_industries
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners and admins manage company industries" ON company_industries;
CREATE POLICY "Owners and admins manage company industries" ON company_industries
  FOR ALL TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
      AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- C. Fix company_search_terms table policies
-- ============================================================

DROP POLICY IF EXISTS "Users can view search terms for their companies" ON company_search_terms;
CREATE POLICY "Users can view search terms for their companies" ON company_search_terms
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins and owners can add search terms" ON company_search_terms;
CREATE POLICY "Admins and owners can add search terms" ON company_search_terms
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
      AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins and owners can update search terms" ON company_search_terms;
CREATE POLICY "Admins and owners can update search terms" ON company_search_terms
  FOR UPDATE TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
      AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins and owners can delete search terms" ON company_search_terms;
CREATE POLICY "Admins and owners can delete search terms" ON company_search_terms
  FOR DELETE TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
      AND om.role IN ('owner', 'admin')
    )
  );
