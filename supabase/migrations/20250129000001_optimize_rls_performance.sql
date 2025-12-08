-- ============================================================================
-- PERFORMANCE OPTIMIZATION: Fix RLS Policy Performance Issues
-- ============================================================================
-- This migration addresses performance warnings from Supabase linter:
-- 1. Auth RLS Initialization Plan - Wrap auth.uid() and is_admin() in SELECT
-- 2. Duplicate Index - Remove duplicate index on company_members
-- ============================================================================

-- ============================================================================
-- PART 1: Fix Auth RLS Initialization Plan Issues
-- ============================================================================
-- Wrap auth.uid() and is_admin() calls in (select ...) to cache results
-- This prevents re-evaluation for each row, significantly improving performance
-- ============================================================================

-- Fix policies on user_onboarding table
DROP POLICY IF EXISTS "Admin read onboarding" ON user_onboarding;
CREATE POLICY "Admin read onboarding" ON user_onboarding
  FOR SELECT USING ((select is_admin()));

DROP POLICY IF EXISTS "Users can insert own onboarding" ON user_onboarding;
CREATE POLICY "Users can insert own onboarding" ON user_onboarding
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own onboarding" ON user_onboarding;
CREATE POLICY "Users can update own onboarding" ON user_onboarding
  FOR UPDATE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own onboarding" ON user_onboarding;
CREATE POLICY "Users can view own onboarding" ON user_onboarding
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users read own onboarding" ON user_onboarding;
CREATE POLICY "Users read own onboarding" ON user_onboarding
  FOR SELECT USING ((select auth.uid()) = user_id);

-- Fix policies on profiles table
DROP POLICY IF EXISTS "Admin read profiles" ON profiles;
CREATE POLICY "Admin read profiles" ON profiles
  FOR SELECT USING ((select is_admin()));

DROP POLICY IF EXISTS "Admin update profiles" ON profiles;
CREATE POLICY "Admin update profiles" ON profiles
  FOR UPDATE USING ((select is_admin()));

DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING ((select is_admin()));

DROP POLICY IF EXISTS "Allow all authenticated users to read profiles" ON profiles;
CREATE POLICY "Allow all authenticated users to read profiles" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users read own profiles" ON profiles;
CREATE POLICY "Users read own profiles" ON profiles
  FOR SELECT USING ((select auth.uid()) = id);

-- Fix policies on companies table
DROP POLICY IF EXISTS "Users can view their companies" ON companies;
CREATE POLICY "Users can view their companies" ON companies
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid())
    )
  );

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

DROP POLICY IF EXISTS "Owners can delete companies" ON companies;
CREATE POLICY "Owners can delete companies" ON companies
  FOR DELETE TO authenticated
  USING (
    id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role = 'owner'
    )
  );

-- Fix policies on company_members table
DROP POLICY IF EXISTS "Users can view their memberships" ON company_members;
CREATE POLICY "Users can view their memberships" ON company_members
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can add members to their companies" ON company_members;
CREATE POLICY "Users can add members to their companies" ON company_members
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users can update memberships" ON company_members;
CREATE POLICY "Users can update memberships" ON company_members
  FOR UPDATE TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users can delete their memberships" ON company_members;
CREATE POLICY "Users can delete their memberships" ON company_members
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admins can manage all memberships" ON company_members;
CREATE POLICY "Admins can manage all memberships" ON company_members
  FOR ALL TO authenticated
  USING ((select is_admin()));

DROP POLICY IF EXISTS "Admins can view all memberships" ON company_members;
CREATE POLICY "Admins can view all memberships" ON company_members
  FOR SELECT TO authenticated
  USING ((select is_admin()));

-- Fix policies on confirmed_prompts table
DROP POLICY IF EXISTS "Users can insert company prompts" ON confirmed_prompts;
CREATE POLICY "Users can insert company prompts" ON confirmed_prompts
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update company prompts" ON confirmed_prompts;
CREATE POLICY "Users can update company prompts" ON confirmed_prompts
  FOR UPDATE TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete company prompts" ON confirmed_prompts;
CREATE POLICY "Users can delete company prompts" ON confirmed_prompts
  FOR DELETE TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view prompts for their companies" ON confirmed_prompts;
CREATE POLICY "Users can view prompts for their companies" ON confirmed_prompts
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view prompts for their organization companies" ON confirmed_prompts;
CREATE POLICY "Users can view prompts for their organization companies" ON confirmed_prompts
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can view all confirmed prompts" ON confirmed_prompts;
CREATE POLICY "Admins can view all confirmed prompts" ON confirmed_prompts
  FOR SELECT USING ((select is_admin()));

-- Fix policies on prompt_responses table
DROP POLICY IF EXISTS "Users can insert company responses" ON prompt_responses;
CREATE POLICY "Users can insert company responses" ON prompt_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update company responses" ON prompt_responses;
CREATE POLICY "Users can update company responses" ON prompt_responses
  FOR UPDATE TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete company responses" ON prompt_responses;
CREATE POLICY "Users can delete company responses" ON prompt_responses
  FOR DELETE TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view responses for their organization companies" ON prompt_responses;
CREATE POLICY "Users can view responses for their organization companies" ON prompt_responses
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins can view all prompt responses" ON prompt_responses;
CREATE POLICY "Admins can view all prompt responses" ON prompt_responses
  FOR SELECT USING ((select is_admin()));

-- Fix policies on organization_members table
DROP POLICY IF EXISTS "Users can view their org memberships" ON organization_members;
CREATE POLICY "Users can view their org memberships" ON organization_members
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admins can insert org members" ON organization_members;
CREATE POLICY "Admins can insert org members" ON organization_members
  FOR INSERT TO authenticated
  WITH CHECK ((select is_admin()));

DROP POLICY IF EXISTS "Admins can view all org members" ON organization_members;
CREATE POLICY "Admins can view all org members" ON organization_members
  FOR SELECT TO authenticated
  USING ((select is_admin()));

-- Fix policies on organization_companies table
DROP POLICY IF EXISTS "Org members can view their org companies" ON organization_companies;
CREATE POLICY "Org members can view their org companies" ON organization_companies
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Org admins can insert companies" ON organization_companies;
CREATE POLICY "Org admins can insert companies" ON organization_companies
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Org admins can update companies" ON organization_companies;
CREATE POLICY "Org admins can update companies" ON organization_companies
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Org admins can delete companies" ON organization_companies;
CREATE POLICY "Org admins can delete companies" ON organization_companies
  FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can view all org companies" ON organization_companies;
CREATE POLICY "Admins can view all org companies" ON organization_companies
  FOR SELECT TO authenticated
  USING ((select is_admin()));

DROP POLICY IF EXISTS "Admins can manage all org companies" ON organization_companies;
CREATE POLICY "Admins can manage all org companies" ON organization_companies
  FOR ALL TO authenticated
  USING ((select is_admin()));

-- Fix policies on organizations table
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
CREATE POLICY "Users can view their organizations" ON organizations
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = (select auth.uid())
    )
  );

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

-- Fix policies on company_search_terms table
DROP POLICY IF EXISTS "Users can view search terms for their companies" ON company_search_terms;
CREATE POLICY "Users can view search terms for their companies" ON company_search_terms
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT cm.company_id
      FROM company_members cm
      WHERE cm.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins and owners can add search terms" ON company_search_terms;
CREATE POLICY "Admins and owners can add search terms" ON company_search_terms
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT cm.company_id
      FROM company_members cm
      WHERE cm.user_id = (select auth.uid()) 
      AND cm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins and owners can update search terms" ON company_search_terms;
CREATE POLICY "Admins and owners can update search terms" ON company_search_terms
  FOR UPDATE TO authenticated
  USING (
    company_id IN (
      SELECT cm.company_id
      FROM company_members cm
      WHERE cm.user_id = (select auth.uid()) 
      AND cm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins and owners can delete search terms" ON company_search_terms;
CREATE POLICY "Admins and owners can delete search terms" ON company_search_terms
  FOR DELETE TO authenticated
  USING (
    company_id IN (
      SELECT cm.company_id
      FROM company_members cm
      WHERE cm.user_id = (select auth.uid()) 
      AND cm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can view all search terms" ON company_search_terms;
CREATE POLICY "Admins can view all search terms" ON company_search_terms
  FOR SELECT TO authenticated
  USING ((select is_admin()));

DROP POLICY IF EXISTS "Admins can manage all search terms" ON company_search_terms;
CREATE POLICY "Admins can manage all search terms" ON company_search_terms
  FOR ALL TO authenticated
  USING ((select is_admin()));

-- Fix policies on company_industries table
DROP POLICY IF EXISTS "Members can view company industries" ON company_industries;
CREATE POLICY "Members can view company industries" ON company_industries
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners and admins manage company industries" ON company_industries;
CREATE POLICY "Owners and admins manage company industries" ON company_industries
  FOR ALL TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = (select auth.uid()) 
      AND role IN ('owner', 'admin')
    )
  );

-- Fix policies on ai_themes table
DROP POLICY IF EXISTS "Users can view AI themes for their companies" ON ai_themes;
CREATE POLICY "Users can view AI themes for their companies" ON ai_themes
  FOR SELECT TO authenticated
  USING (
    prompt_response_id IN (
      SELECT pr.id
      FROM prompt_responses pr
      INNER JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
      WHERE cp.company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can view ai_themes for their company responses" ON ai_themes;
CREATE POLICY "Users can view ai_themes for their company responses" ON ai_themes
  FOR SELECT TO authenticated
  USING (
    prompt_response_id IN (
      SELECT pr.id
      FROM prompt_responses pr
      INNER JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
      WHERE cp.company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can insert ai_themes for company responses" ON ai_themes;
CREATE POLICY "Users can insert ai_themes for company responses" ON ai_themes
  FOR INSERT TO authenticated
  WITH CHECK (
    prompt_response_id IN (
      SELECT pr.id
      FROM prompt_responses pr
      INNER JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
      WHERE cp.company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can update ai_themes for company responses" ON ai_themes;
CREATE POLICY "Users can update ai_themes for company responses" ON ai_themes
  FOR UPDATE TO authenticated
  USING (
    prompt_response_id IN (
      SELECT pr.id
      FROM prompt_responses pr
      INNER JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
      WHERE cp.company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete ai_themes for company responses" ON ai_themes;
CREATE POLICY "Users can delete ai_themes for company responses" ON ai_themes
  FOR DELETE TO authenticated
  USING (
    prompt_response_id IN (
      SELECT pr.id
      FROM prompt_responses pr
      INNER JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
      WHERE cp.company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

-- Fix policies on search_insights tables
DROP POLICY IF EXISTS "Users can view their own search sessions" ON search_insights_sessions;
CREATE POLICY "Users can view their own search sessions" ON search_insights_sessions
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view search sessions for their organization companies" ON search_insights_sessions;
CREATE POLICY "Users can view search sessions for their organization companies" ON search_insights_sessions
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT oc.company_id
      FROM organization_companies oc
      INNER JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE om.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view results for their companies" ON search_insights_results;
CREATE POLICY "Users can view results for their companies" ON search_insights_results
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM search_insights_sessions
      WHERE company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can view search results for their organization companies" ON search_insights_results;
CREATE POLICY "Users can view search results for their organization companies" ON search_insights_results
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM search_insights_sessions
      WHERE company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can view terms for their companies" ON search_insights_terms;
CREATE POLICY "Users can view terms for their companies" ON search_insights_terms
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM search_insights_sessions
      WHERE company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can view search terms for their organization companies" ON search_insights_terms;
CREATE POLICY "Users can view search terms for their organization companies" ON search_insights_terms
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM search_insights_sessions
      WHERE company_id IN (
        SELECT oc.company_id
        FROM organization_companies oc
        INNER JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = (select auth.uid())
      )
    )
  );


-- ============================================================================
-- PART 2: Remove Duplicate Index
-- ============================================================================
-- Remove duplicate index on company_members table
-- Keep idx_company_members_default, drop idx_company_members_user_default if it exists
-- ============================================================================

DROP INDEX IF EXISTS idx_company_members_user_default;

-- ============================================================================
-- Note: Multiple Permissive Policies
-- ============================================================================
-- Multiple permissive policies are intentional for different access patterns
-- (e.g., admin access vs user access). Consolidating them could break functionality.
-- The auth function optimization above should significantly improve performance
-- even with multiple policies.
-- ============================================================================

