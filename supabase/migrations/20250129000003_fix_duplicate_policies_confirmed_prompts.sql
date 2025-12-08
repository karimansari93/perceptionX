-- ============================================================================
-- FIX: Remove Duplicate Policies on confirmed_prompts Table
-- ============================================================================
-- This migration removes duplicate permissive policies for SELECT operations
-- on the confirmed_prompts table. There are two identical policies:
-- 1. "Users can view prompts for their companies"
-- 2. "Users can view prompts for their organization companies"
--
-- Both policies check organization_companies via organization_members, so they
-- are functionally identical. We keep the more descriptive name and remove the
-- duplicate to resolve the "multiple permissive policies" warning.
-- ============================================================================

-- Drop the duplicate policy (keeping the more descriptive one)
DROP POLICY IF EXISTS "Users can view prompts for their companies" ON confirmed_prompts;

-- Ensure we have the correct policies:
-- 1. Admins can view all confirmed prompts
-- 2. Users can view prompts for their organization companies
-- 
-- Note: These are intentionally separate permissive policies as they serve
-- different purposes (admin access vs user access). PostgreSQL RLS allows
-- multiple permissive policies and combines them with OR logic.






