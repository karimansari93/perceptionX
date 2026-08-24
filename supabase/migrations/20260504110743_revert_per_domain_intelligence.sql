-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260504110743; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Revert per-domain intelligence layer.
-- Family is the unit of classification + scoring.
-- source_domains keeps variant metadata (region/language/occurrences) for drill-down only.

-- 1. Strip per-domain intelligence fields off source_domains
ALTER TABLE source_domains
  DROP COLUMN taxonomy_id_override,
  DROP COLUMN authority_score,
  DROP COLUMN ai_visibility_score,
  DROP COLUMN dominant_themes,
  DROP COLUMN intelligence,
  DROP COLUMN last_intelligence_refresh_at;

-- 2. Homepage enrichment back to family-level (one row per family)
DROP TABLE source_homepage_enrichment;

CREATE TABLE source_homepage_enrichment (
  family_id uuid PRIMARY KEY REFERENCES source_families(id) ON DELETE CASCADE,
  fetched_at timestamptz,
  http_status integer,
  redirect_chain text[],
  final_url text,
  page_title text,
  meta_description text,
  detected_language text,
  detected_topics text[],
  visible_text_sample text,
  ssl_subject text,
  ssl_issuer text,
  whois_registrant text,
  whois_org text,
  whois_country text,
  whois_verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_updated_at_homepage BEFORE UPDATE ON source_homepage_enrichment
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();

COMMENT ON TABLE source_homepage_enrichment IS 'One-time homepage fetch + WHOIS + SSL per family. Variants inherit from parent.';

-- 3. Model citation profile: family-only
DROP INDEX IF EXISTS uq_model_profile_family_level;
DROP INDEX IF EXISTS uq_model_profile_domain_level;
DROP INDEX IF EXISTS idx_model_profile_domain;

ALTER TABLE source_model_citation_profile DROP COLUMN source_domain_id;

ALTER TABLE source_model_citation_profile
  ADD CONSTRAINT source_model_citation_profile_uniq
  UNIQUE (family_id, model_name, observation_window_start);

-- 4. Intelligence snapshots: family-only
DROP INDEX IF EXISTS uq_snapshot_family_level;
DROP INDEX IF EXISTS uq_snapshot_domain_level;
DROP INDEX IF EXISTS idx_snapshots_domain;

ALTER TABLE source_intelligence_snapshots DROP COLUMN source_domain_id;

ALTER TABLE source_intelligence_snapshots
  ADD CONSTRAINT source_intelligence_snapshots_uniq
  UNIQUE (family_id, snapshot_date);
