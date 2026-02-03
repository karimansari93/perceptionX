-- Fix search_insights_sessions that have company_id: null
-- This script will update existing search sessions with the correct company_id

-- First, let's see what we're working with
SELECT 
  id,
  company_name,
  company_id,
  user_id,
  created_at
FROM search_insights_sessions 
WHERE company_id IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Update search sessions where company_id is null
-- We'll match by company_name and user_id to find the correct company
UPDATE search_insights_sessions 
SET company_id = (
  SELECT c.id 
  FROM companies c
  JOIN organization_companies oc ON c.id = oc.company_id
  JOIN organization_members om ON oc.organization_id = om.organization_id
  WHERE c.name = search_insights_sessions.company_name
    AND om.user_id = search_insights_sessions.user_id
  LIMIT 1
)
WHERE company_id IS NULL
  AND EXISTS (
    SELECT 1 
    FROM companies c
    JOIN organization_companies oc ON c.id = oc.company_id
    JOIN organization_members om ON oc.organization_id = om.organization_id
    WHERE c.name = search_insights_sessions.company_name
      AND om.user_id = search_insights_sessions.user_id
  );

-- Check the results
SELECT 
  id,
  company_name,
  company_id,
  user_id,
  created_at
FROM search_insights_sessions 
WHERE company_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Count how many were fixed
SELECT 
  COUNT(*) as total_sessions,
  COUNT(company_id) as sessions_with_company_id,
  COUNT(*) - COUNT(company_id) as sessions_without_company_id
FROM search_insights_sessions;

