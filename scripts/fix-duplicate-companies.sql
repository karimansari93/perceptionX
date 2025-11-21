-- ============================================================================
-- Script to fix duplicate company data
-- ============================================================================
-- Run this script to identify and fix companies that incorrectly share the same ID
-- 
-- USAGE:
-- 1. First, run the queries to see what duplicates exist
-- 2. Review the results
-- 3. Run the fix function for each duplicate onboarding record (except the first one)

-- ============================================================================
-- STEP 1: Identify duplicate companies
-- ============================================================================
-- This shows all companies that have multiple onboarding records (duplicates)
SELECT * FROM duplicate_companies_view
ORDER BY duplicate_count DESC, first_created DESC;

-- Alternative: Use the function
SELECT * FROM identify_duplicate_companies()
ORDER BY onboarding_count DESC;

-- ============================================================================
-- STEP 2: See detailed information about each duplicate
-- ============================================================================
-- Replace 'YOUR_COMPANY_ID' with the actual company_id from step 1
/*
SELECT 
  uo.id as onboarding_id,
  uo.company_name,
  uo.industry,
  uo.country,
  uo.company_id,
  uo.created_at,
  uo.user_id,
  -- Count related data
  (SELECT COUNT(*) FROM confirmed_prompts WHERE onboarding_id = uo.id) as prompts_count,
  (SELECT COUNT(*) FROM search_insights_sessions WHERE company_id = uo.company_id AND user_id = uo.user_id) as sessions_count
FROM user_onboarding uo
WHERE uo.company_id = 'YOUR_COMPANY_ID'  -- Replace with actual company_id
ORDER BY uo.created_at ASC;
*/

-- ============================================================================
-- STEP 3: Fix duplicates by creating new companies
-- ============================================================================
-- For each duplicate onboarding record (except the first/oldest one), run:
-- Replace 'DUPLICATE_COMPANY_ID' and 'ONBOARDING_ID' with actual values
/*
SELECT fix_duplicate_company(
  'DUPLICATE_COMPANY_ID'::UUID,  -- The shared company_id
  'ONBOARDING_ID'::UUID          -- The onboarding_id that should get a new company
);
*/

-- ============================================================================
-- STEP 4: Verify the fix
-- ============================================================================
-- After running the fix, verify that duplicates are resolved
SELECT * FROM duplicate_companies_view
ORDER BY duplicate_count DESC;

-- Check that each onboarding record now has its own company
SELECT 
  uo.id as onboarding_id,
  uo.company_name,
  uo.country,
  uo.company_id,
  c.id as company_id_verified,
  CASE 
    WHEN uo.company_id = c.id THEN '✓ Match'
    ELSE '✗ Mismatch'
  END as status
FROM user_onboarding uo
LEFT JOIN companies c ON c.id = uo.company_id
WHERE uo.company_id IS NOT NULL
ORDER BY uo.created_at DESC;

-- ============================================================================
-- EXAMPLE: Fix Cloudera duplicates
-- ============================================================================
-- If you have Cloudera India, Hungary, Spain all with the same company_id:
-- 
-- 1. First, find the company_id and onboarding_ids:
-- SELECT * FROM duplicate_companies_view WHERE company_name = 'Cloudera';
-- 
-- 2. Get the onboarding records:
-- SELECT id, country, created_at FROM user_onboarding 
-- WHERE company_id = 'FOUND_COMPANY_ID' ORDER BY created_at;
--
-- 3. Keep the first one (oldest), fix the others:
-- SELECT fix_duplicate_company('FOUND_COMPANY_ID'::UUID, 'INDIA_ONBOARDING_ID'::UUID);
-- SELECT fix_duplicate_company('FOUND_COMPANY_ID'::UUID, 'HUNGARY_ONBOARDING_ID'::UUID);
-- SELECT fix_duplicate_company('FOUND_COMPANY_ID'::UUID, 'SPAIN_ONBOARDING_ID'::UUID);

