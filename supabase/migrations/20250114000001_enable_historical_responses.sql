-- ============================================================================
-- Enable Historical Response Tracking
-- ============================================================================
-- This migration enables tracking of responses over time by allowing multiple
-- responses for the same prompt+AI model combination from different time periods.

-- PROBLEM: Currently, prompt_responses has a unique constraint on (confirmed_prompt_id, ai_model)
-- This means when admin refreshes, it UPDATES the existing record, losing historical data.

-- SOLUTION: 
-- 1. Remove the unique constraint
-- 2. Allow multiple responses per prompt+model with different tested_at timestamps
-- 3. Dashboard will filter for the most recent responses when displaying current data
-- 4. Can show trends and compare time periods

-- Step 1: Drop the unique constraint that prevents multiple responses
ALTER TABLE prompt_responses 
DROP CONSTRAINT IF EXISTS unique_prompt_response_model;

ALTER TABLE prompt_responses 
DROP CONSTRAINT IF EXISTS unique_response_per_prompt_model;

-- Step 2: Add an index to help with queries that get "latest response per prompt+model"
-- This replaces the unique constraint with a regular index for performance
CREATE INDEX IF NOT EXISTS idx_prompt_responses_lookup 
ON prompt_responses(confirmed_prompt_id, ai_model, tested_at DESC);

-- Step 3: Add an index on company_id + tested_at for dashboard queries
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_time 
ON prompt_responses(company_id, tested_at DESC);

-- Step 4: Create a view that shows only the latest response for each prompt+model combination
-- This makes it easy for the dashboard to get "current" data
CREATE OR REPLACE VIEW latest_prompt_responses AS
SELECT DISTINCT ON (confirmed_prompt_id, ai_model) 
  pr.*
FROM prompt_responses pr
ORDER BY confirmed_prompt_id, ai_model, tested_at DESC;

-- Step 5: Grant permissions on the view
GRANT SELECT ON latest_prompt_responses TO authenticated;
GRANT SELECT ON latest_prompt_responses TO anon;

-- Note: After this migration:
-- - Admin panel will create NEW responses on each refresh (not update)
-- - All historical data is preserved
-- - Dashboard can compare responses from different time periods
-- - Use latest_prompt_responses view for "current snapshot" queries
-- - Use prompt_responses table directly for historical analysis and trends





