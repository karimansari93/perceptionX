-- Add mention tracking columns to search_insights_results table
ALTER TABLE search_insights_results 
ADD COLUMN mention_count INTEGER DEFAULT 1,
ADD COLUMN search_terms_count INTEGER DEFAULT 1,
ADD COLUMN all_search_terms TEXT DEFAULT '';
