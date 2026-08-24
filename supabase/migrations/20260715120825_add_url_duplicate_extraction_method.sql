-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715120825; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Add 'url-duplicate' extraction method: a URL whose recency was copied from an
-- already-resolved sibling that differs only by query string / fragment (tracking
-- params, etc.). Zero-scrape resolution. See audit Rec 4 (URL normalization/dedup).
ALTER TABLE url_recency_cache DROP CONSTRAINT IF EXISTS valid_extraction_method;
ALTER TABLE url_recency_cache ADD CONSTRAINT valid_extraction_method CHECK (
  extraction_method IN (
    'url-pattern','firecrawl-json','firecrawl-html','firecrawl-metadata',
    'firecrawl-relative','firecrawl-absolute','firecrawl-reddit','meta-tag',
    'json-ld','time-tag','openai-html','not-found','rate-limit-hit','timeout',
    'problematic-domain','cache-hit','manual','evergreen','youtube-api',
    'reddit-api','owned-asset','evergreen-domain','social-post','url-duplicate'
  )
) NOT VALID;
NOTIFY pgrst, 'reload schema';
