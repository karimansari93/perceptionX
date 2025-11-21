-- Add company_mentioned column to search_insights_results table
-- This column tracks whether the company name was mentioned in the search result
ALTER TABLE search_insights_results 
ADD COLUMN IF NOT EXISTS company_mentioned BOOLEAN DEFAULT false;

-- Create index for filtering by company mentions
CREATE INDEX IF NOT EXISTS idx_search_insights_results_company_mentioned 
ON search_insights_results(company_mentioned);

