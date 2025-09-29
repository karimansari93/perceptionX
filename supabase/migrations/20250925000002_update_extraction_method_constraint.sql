-- Update the valid_extraction_method constraint to include 'problematic-domain'
ALTER TABLE url_recency_cache 
DROP CONSTRAINT valid_extraction_method;

ALTER TABLE url_recency_cache 
ADD CONSTRAINT valid_extraction_method 
CHECK (extraction_method IN ('url-pattern', 'firecrawl-json', 'firecrawl-html', 'not-found', 'rate-limit-hit', 'timeout', 'problematic-domain'));

