-- ============================================================================
-- Merge Cloudera data from Oct 20, 2025 to Sept 1, 2025
-- ============================================================================
-- This script updates timestamps for Cloudera's prompt_responses that were
-- refreshed on Oct 20, 2025 to show as Sept 1, 2025 data instead.
--
-- Company: Cloudera
-- Company ID: 3196174e-2e92-4ee1-88a9-34b245b970db
-- From Date: October 20, 2025
-- To Date: September 1, 2025
-- Affected: visibility and competitive prompt_type responses (all categories including TalentX)

BEGIN;

-- Step 1: Check records from Oct 20, 2025 by prompt_type
SELECT 
  'BEFORE UPDATE - Oct 20 records by type' as status,
  COALESCE(cp.prompt_type::text, 'NULL') as prompt_type,
  COALESCE(cp.prompt_category::text, 'NULL') as prompt_category,
  COUNT(*) as response_count,
  MIN(pr.tested_at) as earliest_tested,
  MAX(pr.tested_at) as latest_tested
FROM prompt_responses pr
LEFT JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND DATE(pr.tested_at) = '2025-10-20'
GROUP BY cp.prompt_type, cp.prompt_category
ORDER BY cp.prompt_type;

-- Step 1b: Total count of visibility + competitive prompts before update
SELECT 
  'TOTAL visibility + competitive before update' as status,
  COUNT(*) as total_count
FROM prompt_responses pr
JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND DATE(pr.tested_at) = '2025-10-20'
  AND cp.prompt_type IN ('visibility', 'competitive');

-- Step 2: Update prompt_responses timestamps for VISIBILITY and COMPETITIVE prompts ONLY
-- Filter by prompt_type (not prompt_category)
UPDATE prompt_responses
SET 
  tested_at = '2025-09-01 15:25:58.327069+00'::timestamptz,
  updated_at = '2025-09-01 15:25:58.327069+00'::timestamptz,
  created_at = CASE 
    WHEN prompt_responses.created_at > '2025-09-01 15:25:58.327069+00'::timestamptz 
    THEN '2025-09-01 15:25:58.327069+00'::timestamptz
    ELSE prompt_responses.created_at 
  END
FROM confirmed_prompts cp
WHERE prompt_responses.confirmed_prompt_id = cp.id
  AND prompt_responses.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND DATE(prompt_responses.tested_at) = '2025-10-20'
  AND cp.prompt_type IN ('visibility', 'competitive');

-- Step 3: Verify the update - check Sept 1 records by type
SELECT 
  'AFTER UPDATE - Sept 1 records by type' as status,
  COALESCE(cp.prompt_type::text, 'NULL') as prompt_type,
  COALESCE(cp.prompt_category::text, 'NULL') as prompt_category,
  COUNT(*) as response_count,
  MIN(pr.tested_at) as earliest_tested,
  MAX(pr.tested_at) as latest_tested
FROM prompt_responses pr
LEFT JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND DATE(pr.tested_at) = '2025-09-01'
GROUP BY cp.prompt_type, cp.prompt_category
ORDER BY cp.prompt_type;

-- Step 3b: Total visibility + competitive count on Sept 1
SELECT 
  'TOTAL visibility + competitive on Sept 1' as status,
  COUNT(*) as total_count
FROM prompt_responses pr
JOIN confirmed_prompts cp ON pr.confirmed_prompt_id = cp.id
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND DATE(pr.tested_at) = '2025-09-01'
  AND cp.prompt_type IN ('visibility', 'competitive');

-- Step 4: Check if there are any remaining Oct 20 records (should be 0)
SELECT 
  'Remaining Oct 20 records (should be 0)' as status,
  COUNT(*) as count
FROM prompt_responses pr
WHERE pr.company_id = '3196174e-2e92-4ee1-88a9-34b245b970db'
  AND DATE(pr.tested_at) = '2025-10-20';

-- COMMIT the transaction if everything looks good
-- If you want to review first, run ROLLBACK instead
COMMIT;
-- ROLLBACK; -- Uncomment this instead of COMMIT to undo changes

