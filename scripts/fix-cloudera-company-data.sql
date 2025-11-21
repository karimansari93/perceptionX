-- ============================================================================
-- Fix Cloudera company data - ensure each country has its own company_id
-- ============================================================================
-- Based on the data provided, these are the Cloudera onboarding records:
-- 1. IN (India):   onboarding_id=08cc2e82-57eb-4798-b13a-a1f8d9150555, company_id=daa927dd-46c2-4f5e-a6ba-6889c995cd15
-- 2. CZ (Czech):   onboarding_id=e61e67ef-f89e-4364-9630-38487653a62f, company_id=5088f197-7dd9-428e-be85-101ec2ddad6d
-- 3. ES (Spain):   onboarding_id=aef327b3-fc85-4ebe-8f15-d4b83a02a3ed, company_id=1c060d43-7215-4a27-9608-ccbe6c8a20cb
-- 4. HU (Hungary): onboarding_id=957a64ee-dfdf-4bbb-b766-19972f2a0479, company_id=de43c93e-250f-47cd-a0d8-a95ad1f76429

-- ============================================================================
-- STEP 1: Check current state of Cloudera companies
-- ============================================================================
SELECT 
  uo.id as onboarding_id,
  uo.company_name,
  uo.country,
  uo.company_id,
  uo.created_at,
  -- Count related data
  (SELECT COUNT(*) FROM confirmed_prompts WHERE onboarding_id = uo.id) as prompts_count,
  (SELECT COUNT(*) FROM search_insights_sessions WHERE company_id = uo.company_id) as sessions_count,
  (SELECT COUNT(*) FROM search_insights_results WHERE company_id = uo.company_id) as results_count,
  (SELECT COUNT(*) FROM search_insights_terms WHERE company_id = uo.company_id) as terms_count
FROM user_onboarding uo
WHERE uo.company_name = 'Cloudera' 
  AND uo.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
ORDER BY uo.created_at ASC;

-- ============================================================================
-- STEP 2: Check if search sessions have wrong company_id
-- ============================================================================
-- This shows search sessions that might be using the wrong company_id
SELECT 
  sis.id as session_id,
  sis.company_name,
  sis.company_id,
  sis.user_id,
  sis.created_at,
  uo.id as onboarding_id,
  uo.country as onboarding_country,
  uo.company_id as correct_company_id,
  CASE 
    WHEN sis.company_id = uo.company_id THEN '✓ Correct'
    ELSE '✗ Wrong - should be ' || uo.company_id::text
  END as status
FROM search_insights_sessions sis
INNER JOIN user_onboarding uo ON uo.user_id = sis.user_id 
  AND uo.company_name = sis.company_name
  AND uo.company_name = 'Cloudera'
WHERE sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  -- Match by time proximity (within 1 hour of onboarding)
  AND sis.created_at BETWEEN uo.created_at - INTERVAL '1 hour' 
                        AND uo.created_at + INTERVAL '1 hour'
ORDER BY sis.created_at DESC;

-- ============================================================================
-- STEP 3: Fix search sessions - reassign to correct company_id based on timestamp
-- ============================================================================
-- The issue: Multiple sessions are using the wrong company_id
-- Solution: Match sessions to the correct company_id based on creation timestamp
-- and the onboarding record that was active at that time

-- First, let's see which sessions need fixing
SELECT 
  sis.id as session_id,
  sis.created_at as session_created,
  sis.company_id as current_company_id,
  uo.id as onboarding_id,
  uo.country,
  uo.company_id as correct_company_id,
  uo.created_at as onboarding_created,
  CASE 
    WHEN sis.company_id = uo.company_id THEN '✓ Correct'
    ELSE '✗ Wrong'
  END as status
FROM search_insights_sessions sis
CROSS JOIN LATERAL (
  SELECT uo.*
  FROM user_onboarding uo
  WHERE uo.user_id = sis.user_id 
    AND uo.company_name = sis.company_name
    AND uo.company_name = 'Cloudera'
    -- Find the onboarding record that was created closest before this session
    AND uo.created_at <= sis.created_at
  ORDER BY uo.created_at DESC
  LIMIT 1
) uo
WHERE sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
ORDER BY sis.created_at DESC;

-- Now fix the sessions by matching to the most recent onboarding before the session
UPDATE search_insights_sessions sis
SET company_id = (
  SELECT uo.company_id
  FROM user_onboarding uo
  WHERE uo.user_id = sis.user_id 
    AND uo.company_name = sis.company_name
    AND uo.company_name = 'Cloudera'
    -- Find the onboarding record that was created closest before this session
    AND uo.created_at <= sis.created_at
  ORDER BY uo.created_at DESC
  LIMIT 1
)
WHERE sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  -- Only update if company_id is wrong or null
  AND (
    sis.company_id IS NULL 
    OR sis.company_id != (
      SELECT uo.company_id
      FROM user_onboarding uo
      WHERE uo.user_id = sis.user_id 
        AND uo.company_name = sis.company_name
        AND uo.company_name = 'Cloudera'
        AND uo.created_at <= sis.created_at
      ORDER BY uo.created_at DESC
      LIMIT 1
    )
  );

-- ============================================================================
-- STEP 4: Fix search results - update company_id based on session
-- ============================================================================
-- Update search results to use the correct company_id from their session
UPDATE search_insights_results sir
SET company_id = sis.company_id
FROM search_insights_sessions sis
WHERE sir.session_id = sis.id
  AND sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  -- Only update if company_id is null or wrong
  AND (sir.company_id IS NULL OR sir.company_id != sis.company_id);

-- ============================================================================
-- STEP 5: Fix search terms - update company_id based on session
-- ============================================================================
-- Update search terms to use the correct company_id from their session
UPDATE search_insights_terms sit
SET company_id = sis.company_id
FROM search_insights_sessions sis
WHERE sit.session_id = sis.id
  AND sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  -- Only update if company_id is null or wrong
  AND (sit.company_id IS NULL OR sit.company_id != sis.company_id);

-- ============================================================================
-- STEP 6: Verify the fix
-- ============================================================================
-- Check that all data is now correctly assigned
SELECT 
  uo.country,
  uo.company_id,
  uo.created_at,
  COUNT(DISTINCT sis.id) as sessions_count,
  COUNT(DISTINCT sir.id) as results_count,
  COUNT(DISTINCT sit.id) as terms_count
FROM user_onboarding uo
LEFT JOIN search_insights_sessions sis ON sis.company_id = uo.company_id
LEFT JOIN search_insights_results sir ON sir.company_id = uo.company_id
LEFT JOIN search_insights_terms sit ON sit.company_id = uo.company_id
WHERE uo.company_name = 'Cloudera' 
  AND uo.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
GROUP BY uo.country, uo.company_id, uo.created_at
ORDER BY uo.created_at ASC;

-- ============================================================================
-- STEP 7: Check for any remaining issues
-- ============================================================================
-- Find any search sessions/results/terms that still have wrong or null company_id
SELECT 
  'search_insights_sessions' as table_name,
  COUNT(*) as null_or_wrong_count
FROM search_insights_sessions sis
WHERE sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  AND (sis.company_id IS NULL 
    OR NOT EXISTS (
      SELECT 1 FROM user_onboarding uo 
      WHERE uo.company_id = sis.company_id 
        AND uo.company_name = 'Cloudera'
        AND uo.user_id = sis.user_id
    ))

UNION ALL

SELECT 
  'search_insights_results' as table_name,
  COUNT(*) as null_or_wrong_count
FROM search_insights_results sir
INNER JOIN search_insights_sessions sis ON sir.session_id = sis.id
WHERE sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  AND (sir.company_id IS NULL OR sir.company_id != sis.company_id)

UNION ALL

SELECT 
  'search_insights_terms' as table_name,
  COUNT(*) as null_or_wrong_count
FROM search_insights_terms sit
INNER JOIN search_insights_sessions sis ON sit.session_id = sis.id
WHERE sis.user_id = '6c2c553a-0b40-4f95-adf9-8cc6d3b2d473'
  AND sis.company_name = 'Cloudera'
  AND (sit.company_id IS NULL OR sit.company_id != sis.company_id);

