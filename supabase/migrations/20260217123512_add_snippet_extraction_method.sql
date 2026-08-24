-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260217123512; this file was
-- back-filled afterwards and therefore post-dates the deployment.


ALTER TABLE url_recency_cache DROP CONSTRAINT valid_extraction_method;
ALTER TABLE url_recency_cache ADD CONSTRAINT valid_extraction_method 
  CHECK (extraction_method = ANY (ARRAY[
    'url-pattern', 'firecrawl-metadata', 'firecrawl-relative', 'firecrawl-absolute', 
    'firecrawl-reddit', 'firecrawl-json', 'firecrawl-html', 'not-found', 
    'rate-limit-hit', 'timeout', 'problematic-domain', 'cache-hit', 'snippet-extraction',
    'bulk-heuristic'
  ]));

