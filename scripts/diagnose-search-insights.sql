-- Diagnostic script to check search insights data in the database
-- Run this to see what data exists and identify issues

-- 1. Check all search sessions
SELECT 
  id,
  user_id,
  company_id,
  company_name,
  initial_search_term,
  total_results,
  total_related_terms,
  total_volume,
  created_at
FROM search_insights_sessions
ORDER BY created_at DESC
LIMIT 20;

-- 2. Count sessions by company_id (including NULL)
SELECT 
  company_id,
  COUNT(*) as session_count,
  SUM(total_results) as total_results,
  MAX(created_at) as latest_session
FROM search_insights_sessions
GROUP BY company_id
ORDER BY latest_session DESC;

-- 3. Check search results count
SELECT 
  s.company_id,
  s.company_name,
  COUNT(r.id) as result_count,
  MAX(s.created_at) as latest_session
FROM search_insights_sessions s
LEFT JOIN search_insights_results r ON r.session_id = s.id
GROUP BY s.company_id, s.company_name
ORDER BY latest_session DESC;

-- 4. Check for sessions with NULL company_id
SELECT 
  id,
  user_id,
  company_id,
  company_name,
  initial_search_term,
  total_results,
  created_at
FROM search_insights_sessions
WHERE company_id IS NULL
ORDER BY created_at DESC;

-- 5. Check for results with NULL company_id
SELECT 
  r.id,
  r.session_id,
  r.company_id,
  r.search_term,
  r.domain,
  s.company_name,
  s.company_id as session_company_id
FROM search_insights_results r
JOIN search_insights_sessions s ON s.id = r.session_id
WHERE r.company_id IS NULL OR s.company_id IS NULL
ORDER BY r.created_at DESC
LIMIT 50;

-- 6. Check recent sessions for a specific company (replace with actual company_id)
-- SELECT * FROM search_insights_sessions 
-- WHERE company_id = 'YOUR_COMPANY_ID_HERE'
-- ORDER BY created_at DESC;

-- 7. Check for sessions with NULL company_id (these won't be visible via company-based policies)
SELECT 
  'Sessions with NULL company_id' as issue_type,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as session_ids
FROM search_insights_sessions
WHERE company_id IS NULL

UNION ALL

SELECT 
  'Results with NULL company_id' as issue_type,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as result_ids
FROM search_insights_results
WHERE company_id IS NULL

UNION ALL

SELECT 
  'Terms with NULL company_id' as issue_type,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as term_ids
FROM search_insights_terms
WHERE company_id IS NULL;

-- 8. Check sessions and their company_id status
SELECT 
  s.id as session_id,
  s.user_id,
  s.company_id,
  s.company_name,
  s.created_at,
  COUNT(r.id) as result_count,
  COUNT(CASE WHEN r.company_id IS NULL THEN 1 END) as results_with_null_company_id,
  COUNT(t.id) as term_count,
  COUNT(CASE WHEN t.company_id IS NULL THEN 1 END) as terms_with_null_company_id
FROM search_insights_sessions s
LEFT JOIN search_insights_results r ON r.session_id = s.id
LEFT JOIN search_insights_terms t ON t.session_id = s.id
GROUP BY s.id, s.user_id, s.company_id, s.company_name, s.created_at
ORDER BY s.created_at DESC
LIMIT 20;

-- 9. Check if users are members of companies for sessions
SELECT 
  s.id as session_id,
  s.user_id,
  s.company_id,
  s.company_name,
  CASE 
    WHEN s.company_id IS NULL THEN 'NULL company_id - will not match company-based policies'
    WHEN EXISTS (
      SELECT 1 FROM company_members cm 
      WHERE cm.company_id = s.company_id 
      AND cm.user_id = s.user_id
    ) THEN 'User is member of company'
    ELSE 'User is NOT member of company - will not see via company-based policies'
  END as visibility_status
FROM search_insights_sessions s
ORDER BY s.created_at DESC
LIMIT 20;

-- 10. Check RLS policies (should show if policies are blocking access)
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename LIKE 'search_insights%'
ORDER BY tablename, policyname;

