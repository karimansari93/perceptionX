-- Fix NULL company_id in search_insights tables
-- This migration backfills company_id for existing records that have NULL values

-- Step 1: Update search_insights_sessions with NULL company_id
-- Try to get company_id from user's default company membership
UPDATE search_insights_sessions s
SET company_id = (
  SELECT cm.company_id
  FROM company_members cm
  WHERE cm.user_id = s.user_id
  AND cm.is_default = true
  LIMIT 1
)
WHERE s.company_id IS NULL
AND EXISTS (
  SELECT 1
  FROM company_members cm
  WHERE cm.user_id = s.user_id
  AND cm.is_default = true
);

-- Step 2: Update search_insights_results with NULL company_id from their session
UPDATE search_insights_results r
SET company_id = (
  SELECT s.company_id
  FROM search_insights_sessions s
  WHERE s.id = r.session_id
)
WHERE r.company_id IS NULL
AND EXISTS (
  SELECT 1
  FROM search_insights_sessions s
  WHERE s.id = r.session_id
  AND s.company_id IS NOT NULL
);

-- Step 3: Update search_insights_terms with NULL company_id from their session
UPDATE search_insights_terms t
SET company_id = (
  SELECT s.company_id
  FROM search_insights_sessions s
  WHERE s.id = t.session_id
)
WHERE t.company_id IS NULL
AND EXISTS (
  SELECT 1
  FROM search_insights_sessions s
  WHERE s.id = t.session_id
  AND s.company_id IS NOT NULL
);

-- Step 4: Report on remaining NULL values
DO $$
DECLARE
  sessions_null_count INTEGER;
  results_null_count INTEGER;
  terms_null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sessions_null_count
  FROM search_insights_sessions
  WHERE company_id IS NULL;
  
  SELECT COUNT(*) INTO results_null_count
  FROM search_insights_results
  WHERE company_id IS NULL;
  
  SELECT COUNT(*) INTO terms_null_count
  FROM search_insights_terms
  WHERE company_id IS NULL;
  
  RAISE NOTICE 'Remaining NULL company_id counts:';
  RAISE NOTICE '  Sessions: %', sessions_null_count;
  RAISE NOTICE '  Results: %', results_null_count;
  RAISE NOTICE '  Terms: %', terms_null_count;
END $$;

