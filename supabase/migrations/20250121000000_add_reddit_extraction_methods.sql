-- Add new extraction methods for Reddit and other improvements
ALTER TABLE url_recency_cache 
DROP CONSTRAINT IF EXISTS valid_extraction_method;

ALTER TABLE url_recency_cache 
ADD CONSTRAINT valid_extraction_method CHECK (
  extraction_method IN (
    'url-pattern', 
    'firecrawl-metadata', 
    'firecrawl-relative', 
    'firecrawl-absolute',
    'firecrawl-reddit',
    'firecrawl-json', 
    'firecrawl-html', 
    'not-found', 
    'rate-limit-hit', 
    'timeout',
    'problematic-domain',
    'cache-hit'
  )
);



