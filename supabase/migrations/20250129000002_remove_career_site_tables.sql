-- ============================================================================
-- Remove Career Site Analysis Tables
-- ============================================================================
-- Drop tables and related objects for career site analysis feature
-- This feature has been removed from the application
-- ============================================================================

-- Drop RLS policies first (if they exist)
DROP POLICY IF EXISTS "Users can view their own career site analyses" ON career_site_analyses;
DROP POLICY IF EXISTS "Users can insert their own career site analyses" ON career_site_analyses;
DROP POLICY IF EXISTS "Users can update their own career site analyses" ON career_site_analyses;
DROP POLICY IF EXISTS "Users can delete their own career site analyses" ON career_site_analyses;

DROP POLICY IF EXISTS "Users can view their own career site crawls" ON career_site_crawls;
DROP POLICY IF EXISTS "Users can insert their own career site crawls" ON career_site_crawls;
DROP POLICY IF EXISTS "Users can update their own career site crawls" ON career_site_crawls;
DROP POLICY IF EXISTS "Users can delete their own career site crawls" ON career_site_crawls;

-- Drop tables (CASCADE will remove dependent objects like indexes, constraints, etc.)
DROP TABLE IF EXISTS career_site_analyses CASCADE;
DROP TABLE IF EXISTS career_site_crawls CASCADE;

-- Note: If there are any foreign key references from other tables, 
-- they will be dropped automatically due to CASCADE









