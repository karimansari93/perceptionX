-- ============================================================================
-- Fix multi-tenant data leak on public.companies
-- ============================================================================
--
-- PROBLEM
-- -------
-- `public.companies` has two SELECT policies:
--
--   1. "Users can view their companies"  — scoped to orgs the user belongs to
--      USING (id IN (SELECT oc.company_id FROM organization_companies oc
--                    JOIN organization_members om ON om.organization_id = oc.organization_id
--                    WHERE om.user_id = auth.uid()))
--
--   2. "companies_select_policy" — OPEN TO THE WORLD
--      USING (true)
--
-- Postgres OR's multiple RLS SELECT policies together, which means policy (2)
-- completely defeats policy (1). Any authenticated user can call
-- `supabase.from('companies').select('*')` from DevTools and get every row
-- across every tenant.
--
-- FIX
-- ---
-- Drop the open policy. Upgrade the scoped policy to also allow admins
-- (matching the is_admin() bypass pattern used by other policies in this DB)
-- so internal admin tooling continues to work.
--
-- BLAST RADIUS
-- ------------
-- Consumers that depended on the open policy will lose access. Based on
-- code audit:
--   - `useCompany` fetches companies via `.in('id', companyIds)` where the
--     ID list is already scoped through organization_members / company_members
--     — both of which have properly scoped RLS. So the IN clause caps access
--     regardless of the companies policy.
--   - Admin flows use service_role (bypasses RLS) or the is_admin() branch
--     we're adding below.
--   - Anonymous users lose access to the companies table. No known consumer.
--
-- ============================================================================

BEGIN;

-- 1. Make the scoped policy also allow admins. We replace instead of ALTER
--    because pg_policy USING expressions can't be ALTERed cleanly.
DROP POLICY IF EXISTS "Users can view their companies" ON public.companies;

CREATE POLICY "Users can view their companies"
    ON public.companies FOR SELECT
    TO authenticated
    USING (
        is_admin()
        OR id IN (
            SELECT oc.company_id
            FROM public.organization_companies oc
            JOIN public.organization_members om ON om.organization_id = oc.organization_id
            WHERE om.user_id = (SELECT auth.uid())
        )
        OR id IN (
            -- Also allow direct company_members membership, which is the
            -- legacy path still used by some onboarding flows.
            SELECT cm.company_id
            FROM public.company_members cm
            WHERE cm.user_id = (SELECT auth.uid())
        )
    );

-- 2. Drop the open-world policy.
DROP POLICY IF EXISTS "companies_select_policy" ON public.companies;

-- 3. Sanity comment for future archaeologists.
COMMENT ON POLICY "Users can view their companies" ON public.companies IS
    'Users can read companies in any org they belong to OR any company they are a direct member of. Admins bypass via is_admin(). Replaces the previous `companies_select_policy USING (true)` which leaked every row to every authenticated user.';

COMMIT;
