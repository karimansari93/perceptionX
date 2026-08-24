-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713143914; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- The valid_extraction_method CHECK is NOT VALID and its allowlist is stale:
-- it omits 'owned-asset' and 'evergreen-domain' (already present in 2,907 + 25,431 rows,
-- grandfathered because NOT VALID skips existing rows but enforces on UPDATE).
-- Extend the allowlist with the two already-in-use values plus the new 'social-post',
-- preserving the NOT VALID posture (do not newly scan/validate existing rows).
alter table public.url_recency_cache drop constraint valid_extraction_method;
alter table public.url_recency_cache add constraint valid_extraction_method
  check (extraction_method = any (array[
    'url-pattern','firecrawl-json','firecrawl-html','firecrawl-metadata','firecrawl-relative',
    'firecrawl-absolute','firecrawl-reddit','meta-tag','json-ld','time-tag','openai-html',
    'not-found','rate-limit-hit','timeout','problematic-domain','cache-hit','manual','evergreen',
    'youtube-api','reddit-api','owned-asset','evergreen-domain','social-post'
  ])) not valid;

