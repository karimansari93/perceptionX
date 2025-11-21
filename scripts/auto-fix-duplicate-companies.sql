-- ============================================================================
-- Automated script to fix ALL duplicate companies
-- ============================================================================
-- WARNING: Review the output of STEP 1 before running STEP 2!
-- This script will create new companies for all duplicate onboarding records
-- (keeping the first/oldest onboarding record with the original company_id)

-- ============================================================================
-- STEP 1: Preview what will be fixed (RUN THIS FIRST!)
-- ============================================================================
WITH duplicates AS (
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.industry,
    oc.organization_id,
    ARRAY_AGG(uo.id ORDER BY uo.created_at) as onboarding_ids,
    ARRAY_AGG(uo.country ORDER BY uo.created_at) as countries,
    ARRAY_AGG(uo.created_at ORDER BY uo.created_at) as created_dates
  FROM companies c
  INNER JOIN organization_companies oc ON oc.company_id = c.id
  INNER JOIN user_onboarding uo ON uo.company_id = c.id
  WHERE uo.company_name = c.name 
    AND uo.industry = c.industry
  GROUP BY c.id, c.name, c.industry, oc.organization_id
  HAVING COUNT(DISTINCT uo.id) > 1
)
SELECT 
  company_id,
  company_name,
  industry,
  array_length(onboarding_ids, 1) as total_duplicates,
  onboarding_ids[1] as keep_onboarding_id,  -- First one keeps the original company
  onboarding_ids[2:] as fix_onboarding_ids,  -- Rest get new companies
  countries,
  created_dates
FROM duplicates
ORDER BY array_length(onboarding_ids, 1) DESC;

-- ============================================================================
-- STEP 2: Actually fix the duplicates (UNCOMMENT TO RUN)
-- ============================================================================
-- Only run this after reviewing STEP 1 output!
/*
DO $$
DECLARE
  duplicate_record RECORD;
  onboarding_id_to_fix UUID;
  new_company_id UUID;
BEGIN
  -- Loop through all duplicate companies
  FOR duplicate_record IN
    WITH duplicates AS (
      SELECT 
        c.id as company_id,
        ARRAY_AGG(uo.id ORDER BY uo.created_at) as onboarding_ids
      FROM companies c
      INNER JOIN organization_companies oc ON oc.company_id = c.id
      INNER JOIN user_onboarding uo ON uo.company_id = c.id
      WHERE uo.company_name = c.name 
        AND uo.industry = c.industry
      GROUP BY c.id
      HAVING COUNT(DISTINCT uo.id) > 1
    )
    SELECT company_id, onboarding_ids
    FROM duplicates
  LOOP
    -- Keep the first onboarding record (oldest), fix the rest
    FOR i IN 2..array_length(duplicate_record.onboarding_ids, 1) LOOP
      onboarding_id_to_fix := duplicate_record.onboarding_ids[i];
      
      RAISE NOTICE 'Fixing duplicate: company_id=%, onboarding_id=%', 
        duplicate_record.company_id, onboarding_id_to_fix;
      
      -- Call the fix function
      SELECT fix_duplicate_company(
        duplicate_record.company_id,
        onboarding_id_to_fix
      ) INTO new_company_id;
      
      RAISE NOTICE 'Created new company_id=% for onboarding_id=%', 
        new_company_id, onboarding_id_to_fix;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Finished fixing all duplicates';
END $$;
*/

-- ============================================================================
-- STEP 3: Verify the fix
-- ============================================================================
-- After running STEP 2, verify that all duplicates are resolved
SELECT 
  COUNT(*) as remaining_duplicates
FROM duplicate_companies_view;

-- Should return 0 if all duplicates were fixed

-- Show summary of companies now
SELECT 
  c.id,
  c.name,
  c.industry,
  COUNT(DISTINCT uo.id) as onboarding_count,
  ARRAY_AGG(DISTINCT uo.country) FILTER (WHERE uo.country IS NOT NULL) as countries
FROM companies c
INNER JOIN user_onboarding uo ON uo.company_id = c.id
WHERE uo.company_name = c.name AND uo.industry = c.industry
GROUP BY c.id, c.name, c.industry
HAVING COUNT(DISTINCT uo.id) > 1
ORDER BY onboarding_count DESC;

