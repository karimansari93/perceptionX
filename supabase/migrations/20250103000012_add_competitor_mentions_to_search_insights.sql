-- Add competitor_mentions column to search_insights_results table
ALTER TABLE search_insights_results 
ADD COLUMN competitor_mentions JSONB DEFAULT '[]'::jsonb;
