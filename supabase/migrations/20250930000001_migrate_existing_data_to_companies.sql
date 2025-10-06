-- Migrate existing user_onboarding data to the new multi-company structure
-- This script moves all existing company data from user_onboarding to companies table
-- and creates company_members relationships

-- Step 1: Migrate existing companies from user_onboarding to companies table
INSERT INTO companies (id, name, industry, company_size, competitors, created_at, created_by)
SELECT 
  gen_random_uuid() as id,
  uo.company_name as name,
  uo.industry,
  uo.company_size,
  uo.competitors,
  uo.created_at,
  uo.user_id as created_by
FROM user_onboarding uo
WHERE uo.company_name IS NOT NULL 
  AND uo.industry IS NOT NULL
  -- Only migrate the most recent onboarding record per user
  AND uo.id IN (
    SELECT DISTINCT ON (user_id) id
    FROM user_onboarding
    WHERE company_name IS NOT NULL
    ORDER BY user_id, created_at DESC
  )
ON CONFLICT DO NOTHING;

-- Step 2: Create company_members relationships
-- Each user becomes the owner of their company
INSERT INTO company_members (user_id, company_id, role, is_default, joined_at, invited_by)
SELECT 
  uo.user_id,
  c.id as company_id,
  'owner' as role,
  true as is_default,  -- First company is default
  uo.created_at as joined_at,
  NULL as invited_by  -- Original users weren't invited
FROM user_onboarding uo
INNER JOIN companies c ON c.name = uo.company_name 
  AND c.industry = uo.industry
  AND c.created_by = uo.user_id
WHERE uo.company_name IS NOT NULL 
  AND uo.industry IS NOT NULL
  -- Only migrate the most recent onboarding record per user
  AND uo.id IN (
    SELECT DISTINCT ON (user_id) id
    FROM user_onboarding
    WHERE company_name IS NOT NULL
    ORDER BY user_id, created_at DESC
  )
ON CONFLICT (user_id, company_id) DO NOTHING;

-- Step 3: Update confirmed_prompts with company_id and created_by
-- Map prompts to companies based on user's onboarding record
UPDATE confirmed_prompts cp
SET 
  company_id = cm.company_id,
  created_by = cp.user_id
FROM company_members cm
WHERE cp.user_id = cm.user_id
  AND cm.is_default = true
  AND cp.company_id IS NULL;

-- Step 4: Update search_insights_sessions with company_id
-- Map search sessions to companies based on company name
UPDATE search_insights_sessions sis
SET company_id = c.id
FROM companies c
WHERE sis.company_name = c.name
  AND sis.company_id IS NULL;

-- Step 5: Add NOT NULL constraints after migration (commented out for safety)
-- Uncomment these after verifying the migration was successful
-- ALTER TABLE confirmed_prompts ALTER COLUMN company_id SET NOT NULL;
-- ALTER TABLE confirmed_prompts ALTER COLUMN created_by SET NOT NULL;

-- Step 6: Verification queries (run these to check migration success)
-- SELECT COUNT(*) as total_companies FROM companies;
-- SELECT COUNT(*) as total_memberships FROM company_members;
-- SELECT COUNT(*) as prompts_with_company FROM confirmed_prompts WHERE company_id IS NOT NULL;
-- SELECT COUNT(*) as prompts_without_company FROM confirmed_prompts WHERE company_id IS NULL;

-- Step 7: Show migration summary
DO $$
DECLARE
  v_companies_count INT;
  v_members_count INT;
  v_prompts_migrated INT;
  v_prompts_pending INT;
BEGIN
  SELECT COUNT(*) INTO v_companies_count FROM companies;
  SELECT COUNT(*) INTO v_members_count FROM company_members;
  SELECT COUNT(*) INTO v_prompts_migrated FROM confirmed_prompts WHERE company_id IS NOT NULL;
  SELECT COUNT(*) INTO v_prompts_pending FROM confirmed_prompts WHERE company_id IS NULL;
  
  RAISE NOTICE '=== MIGRATION SUMMARY ===';
  RAISE NOTICE 'Companies created: %', v_companies_count;
  RAISE NOTICE 'Company memberships created: %', v_members_count;
  RAISE NOTICE 'Prompts migrated: %', v_prompts_migrated;
  RAISE NOTICE 'Prompts pending migration: %', v_prompts_pending;
  RAISE NOTICE '========================';
END $$;


