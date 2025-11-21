-- ============================================================================
-- Add missing company_id column to prompt_responses table
-- ============================================================================
-- This migration adds the company_id column that was referenced but never created

-- Step 1: Add company_id column to prompt_responses
ALTER TABLE prompt_responses 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Step 2: Populate company_id from confirmed_prompts
UPDATE prompt_responses 
SET company_id = (
  SELECT cp.company_id 
  FROM confirmed_prompts cp 
  WHERE cp.id = prompt_responses.confirmed_prompt_id
)
WHERE company_id IS NULL
AND confirmed_prompt_id IS NOT NULL;

-- Step 3: Create index for performance
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_id 
ON prompt_responses(company_id);

-- Step 4: Add company_id to search_insights tables if missing
ALTER TABLE search_insights_sessions
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE search_insights_results
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE search_insights_terms
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Step 5: Populate company_id in search_insights_sessions
UPDATE search_insights_sessions 
SET company_id = (
  SELECT cm.company_id 
  FROM company_members cm 
  WHERE cm.user_id = search_insights_sessions.user_id 
  AND cm.is_default = true 
  LIMIT 1
)
WHERE company_id IS NULL 
AND user_id IS NOT NULL;

-- Step 6: Populate company_id in search_insights_results from sessions
UPDATE search_insights_results
SET company_id = (
  SELECT s.company_id
  FROM search_insights_sessions s
  WHERE s.id = search_insights_results.session_id
)
WHERE company_id IS NULL
AND session_id IS NOT NULL;

-- Step 7: Populate company_id in search_insights_terms from sessions
UPDATE search_insights_terms
SET company_id = (
  SELECT s.company_id
  FROM search_insights_sessions s
  WHERE s.id = search_insights_terms.session_id
)
WHERE company_id IS NULL
AND session_id IS NOT NULL;

-- Step 8: Create indexes
CREATE INDEX IF NOT EXISTS idx_search_insights_sessions_company_id 
ON search_insights_sessions(company_id);

CREATE INDEX IF NOT EXISTS idx_search_insights_results_company_id 
ON search_insights_results(company_id);

CREATE INDEX IF NOT EXISTS idx_search_insights_terms_company_id 
ON search_insights_terms(company_id);

-- Step 9: Verify the fix
SELECT 
  'prompt_responses' as table_name,
  COUNT(*) as total_rows,
  COUNT(company_id) as rows_with_company_id,
  COUNT(*) - COUNT(company_id) as rows_without_company_id
FROM prompt_responses
UNION ALL
SELECT 
  'confirmed_prompts' as table_name,
  COUNT(*) as total_rows,
  COUNT(company_id) as rows_with_company_id,
  COUNT(*) - COUNT(company_id) as rows_without_company_id
FROM confirmed_prompts
UNION ALL
SELECT 
  'search_insights_sessions' as table_name,
  COUNT(*) as total_rows,
  COUNT(company_id) as rows_with_company_id,
  COUNT(*) - COUNT(company_id) as rows_without_company_id
FROM search_insights_sessions;



