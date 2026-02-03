-- =============================================================================
-- Diagnose: why responses for this company don't all show in the Prompts tab
-- Company ID: 0ae3a533-518f-4096-a4da-5885d480a257
-- Run each block in Supabase SQL Editor.
-- =============================================================================

-- 1) Total rows in prompt_responses that have company_id = this company (these are what the app loads)
SELECT COUNT(*) AS responses_with_this_company_id
FROM prompt_responses
WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257';

-- 2) Responses that BELONG to this company via confirmed_prompts but have WRONG or NULL company_id on the row
--    The app filters by .eq('company_id', currentCompany.id), so these rows are NEVER returned → missing from Prompts tab
SELECT COUNT(*) AS responses_missing_because_wrong_company_id
FROM prompt_responses pr
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE cp.company_id = '0ae3a533-518f-4096-a4da-5885d480a257'
  AND (pr.company_id IS NULL OR pr.company_id != '0ae3a533-518f-4096-a4da-5885d480a257');

-- 3) List those rows (so you can fix company_id)
SELECT pr.id, pr.company_id AS response_company_id, pr.confirmed_prompt_id, pr.tested_at
FROM prompt_responses pr
JOIN confirmed_prompts cp ON cp.id = pr.confirmed_prompt_id
WHERE cp.company_id = '0ae3a533-518f-4096-a4da-5885d480a257'
  AND (pr.company_id IS NULL OR pr.company_id != '0ae3a533-518f-4096-a4da-5885d480a257')
ORDER BY pr.tested_at DESC;

-- 4) Is this company linked to an org? (If not, RLS would hide all its responses for non-admin users)
SELECT EXISTS (
  SELECT 1 FROM organization_companies WHERE company_id = '0ae3a533-518f-4096-a4da-5885d480a257'
) AS company_in_org;

-- 5) One-shot fix: set company_id on prompt_responses from confirmed_prompts where it's wrong/missing
--    Uncomment and run ONLY after you've confirmed step 2 shows the problem.
/*
UPDATE prompt_responses pr
SET company_id = cp.company_id
FROM confirmed_prompts cp
WHERE cp.id = pr.confirmed_prompt_id
  AND cp.company_id = '0ae3a533-518f-4096-a4da-5885d480a257'
  AND (pr.company_id IS NULL OR pr.company_id != cp.company_id);
*/
