-- ============================================================================
-- CRITICAL SECURITY FIX: Enable Row Level Security (RLS) on tables
-- ============================================================================
-- This migration fixes CRITICAL security linter errors where RLS policies 
-- exist but RLS is not enabled on the underlying tables. Without RLS enabled,
-- the policies are not enforced, leaving the database vulnerable.
--
-- Affected tables:
-- - companies (RLS was temporarily disabled in 20250120000000_disable_companies_rls_temp.sql)
-- - confirmed_prompts (RLS was never enabled)
-- - profiles (RLS was never enabled)
-- - prompt_responses (RLS was never enabled)
-- - user_onboarding (RLS was never enabled)
-- ============================================================================

-- Enable RLS on companies table
-- Note: RLS was temporarily disabled in 20250120000000_disable_companies_rls_temp.sql
-- but policies still exist, so we need to re-enable it for security
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Enable RLS on confirmed_prompts table
-- Policies exist (as confirmed by linter) but RLS was never enabled
ALTER TABLE confirmed_prompts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on profiles table
-- Policies exist (as confirmed by linter) but RLS was never enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on prompt_responses table
-- Policies exist (as confirmed by linter) but RLS was never enabled
ALTER TABLE prompt_responses ENABLE ROW LEVEL SECURITY;

-- Enable RLS on user_onboarding table
-- Policies exist (as confirmed by linter) but RLS was never enabled
ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Verification Query (uncomment to verify RLS is enabled after migration)
-- ============================================================================
-- SELECT 
--   tablename,
--   rowsecurity as rls_enabled,
--   (SELECT COUNT(*) FROM pg_policies WHERE tablename = t.tablename) as policy_count
-- FROM pg_tables t
-- WHERE schemaname = 'public' 
-- AND tablename IN ('companies', 'confirmed_prompts', 'profiles', 'prompt_responses', 'user_onboarding')
-- ORDER BY tablename;
-- ============================================================================

