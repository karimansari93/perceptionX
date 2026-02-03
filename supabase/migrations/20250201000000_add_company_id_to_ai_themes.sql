-- ============================================================================
-- Add company_id column to ai_themes table
-- ============================================================================
-- This migration adds company_id to ai_themes for easier company-based queries
-- and exports. The company_id is derived from prompt_responses which already
-- has company_id populated.

-- Step 1: Add company_id column to ai_themes
ALTER TABLE ai_themes 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Step 2: Populate company_id from prompt_responses
UPDATE ai_themes 
SET company_id = (
  SELECT pr.company_id 
  FROM prompt_responses pr 
  WHERE pr.id = ai_themes.response_id
)
WHERE company_id IS NULL
AND response_id IS NOT NULL;

-- Step 3: Create index for performance
CREATE INDEX IF NOT EXISTS idx_ai_themes_company_id 
ON ai_themes(company_id);

-- Step 4: Verify the migration
SELECT 
  'ai_themes' as table_name,
  COUNT(*) as total_rows,
  COUNT(company_id) as rows_with_company_id,
  COUNT(*) - COUNT(company_id) as rows_without_company_id
FROM ai_themes;
