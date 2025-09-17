-- Add detected_competitors column to search_insights_results table
ALTER TABLE search_insights_results 
ADD COLUMN detected_competitors TEXT DEFAULT '';
