-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260504110959; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Phase 2: Migrate existing directory_sources into source_families + source_domains
-- - Parent rows (parent_domain IS NULL) → 1 source_family + 1 canonical source_domain
-- - Child rows (parent_domain IS NOT NULL) → 1 variant source_domain attached to parent's family
-- - Rich legacy metadata stashed in source_families.intelligence jsonb for later promotion

-- Step 1: Create source_families from parent rows
INSERT INTO source_families (
  slug, name, description, taxonomy_id,
  homepage_url, primary_regions, intelligence,
  last_intelligence_refresh_at
)
SELECT
  regexp_replace(regexp_replace(lower(ds.name), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g') AS slug,
  ds.name,
  ds.description,
  st.id AS taxonomy_id,
  'https://' || ds.domain AS homepage_url,
  COALESCE(ds.country_focus, ARRAY[]::text[]) AS primary_regions,
  jsonb_build_object(
    'legacy_directory_id', ds.id,
    'legacy_category', ds.category,
    'legacy_source_type', ds.source_type,
    'primary_prompt_types', ds.primary_prompt_types,
    'primary_themes', ds.primary_themes,
    'tracked_signals', ds.tracked_signals,
    'actionability', ds.actionability,
    'use_cases', ds.use_cases,
    'best_for', ds.best_for,
    'nuances', ds.nuances,
    'legacy_global_citation_count', ds.global_citation_count,
    'legacy_is_active', ds.is_active
  ) AS intelligence,
  now() AS last_intelligence_refresh_at
FROM directory_sources ds
LEFT JOIN source_taxonomy st ON st.slug = (
  CASE ds.category
    WHEN 'review' THEN 'employer_review'
    WHEN 'jobs' THEN 'job_boards'
    WHEN 'social' THEN 'community_social'
    WHEN 'community' THEN 'community_social'
    WHEN 'rankings' THEN 'rankings'
    WHEN 'reference' THEN 'reference'
    WHEN 'compensation' THEN 'compensation'
    WHEN 'news' THEN 'editorial_news'
  END
)
WHERE ds.parent_domain IS NULL
ON CONFLICT (slug) DO NOTHING;

-- Step 2: Create canonical source_domains for parent rows
INSERT INTO source_domains (
  domain, family_id, registrable_domain, region, is_canonical,
  classification_method, classification_confidence, occurrence_count
)
SELECT
  ds.domain,
  sf.id,
  ds.domain,
  CASE WHEN array_length(ds.country_focus, 1) = 1 THEN ds.country_focus[1] ELSE NULL END,
  true,
  'imported',
  1.0,
  COALESCE(ds.global_citation_count, 0)
FROM directory_sources ds
JOIN source_families sf
  ON sf.slug = regexp_replace(regexp_replace(lower(ds.name), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g')
WHERE ds.parent_domain IS NULL
ON CONFLICT (domain) DO NOTHING;

-- Step 3: Create variant source_domains for child rows (attach to parent's family)
INSERT INTO source_domains (
  domain, family_id, registrable_domain, region, is_canonical,
  classification_method, classification_confidence, occurrence_count
)
SELECT
  ds.domain,
  parent_sd.family_id,
  ds.parent_domain,
  CASE WHEN array_length(ds.country_focus, 1) = 1 THEN ds.country_focus[1] ELSE NULL END,
  false,
  'imported',
  1.0,
  COALESCE(ds.global_citation_count, 0)
FROM directory_sources ds
JOIN source_domains parent_sd
  ON parent_sd.domain = ds.parent_domain AND parent_sd.is_canonical = true
WHERE ds.parent_domain IS NOT NULL
ON CONFLICT (domain) DO NOTHING;

-- Step 4: Audit log
INSERT INTO source_classification_history (
  family_id, source_domain_id, changed_by, change_type, after, reason
)
SELECT
  sd.family_id,
  sd.id,
  'migration:phase_2',
  'created',
  jsonb_build_object(
    'domain', sd.domain,
    'is_canonical', sd.is_canonical,
    'family_id', sd.family_id
  ),
  'Imported from directory_sources during Phase 2 migration'
FROM source_domains sd
WHERE sd.classification_method = 'imported';
