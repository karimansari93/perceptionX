-- Add 'url-duplicate' extraction method.
-- A URL whose recency was copied from an already-resolved sibling that differs
-- only by query string / fragment (utm/fbclid/#:~:text= etc.) — same page, same
-- publication date, zero scrape. This is the write-side of audit Rec 4 (URL
-- normalization / dedup): instead of paying to re-resolve tracking-param variants
-- of a URL we've already dated, we propagate the known date to the variant.
--
-- The recency_score for the variant is recomputed from the sibling's
-- publication_date at propagation time (same buckets as calculateRecencyScore in
-- the extract-recency-scores edge function), so it isn't a stale copy.

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
