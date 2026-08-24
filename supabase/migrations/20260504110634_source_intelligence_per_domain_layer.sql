-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260504110634; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Per-domain intelligence layer (corrected constraint names)

-- 1. Source domains: per-domain intelligence fields
ALTER TABLE source_domains
  ADD COLUMN taxonomy_id_override uuid REFERENCES source_taxonomy(id) ON DELETE SET NULL,
  ADD COLUMN authority_score numeric(5,2),
  ADD COLUMN ai_visibility_score numeric(5,2),
  ADD COLUMN dominant_themes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN intelligence jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN last_intelligence_refresh_at timestamptz;

COMMENT ON COLUMN source_domains.taxonomy_id_override IS 'Optional. If set, overrides the family''s taxonomy for this specific domain. Otherwise inherits.';
COMMENT ON COLUMN source_domains.dominant_themes IS 'Empirical theme association for this specific domain, derived from prompt_responses citing it.';
COMMENT ON COLUMN source_domains.intelligence IS 'Catch-all for evolving per-domain signals.';

-- 2. Re-key homepage enrichment to domain level
DROP TABLE source_homepage_enrichment;

CREATE TABLE source_homepage_enrichment (
  source_domain_id uuid PRIMARY KEY REFERENCES source_domains(id) ON DELETE CASCADE,
  family_id uuid REFERENCES source_families(id) ON DELETE CASCADE,
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
CREATE INDEX idx_homepage_family ON source_homepage_enrichment(family_id);

CREATE TRIGGER set_updated_at_homepage BEFORE UPDATE ON source_homepage_enrichment
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();

COMMENT ON TABLE source_homepage_enrichment IS 'Per-domain homepage fetch. glassdoor.de and glassdoor.com have separate rows. family_id denormalized for query convenience.';

-- 3. Model citation profile: dual-level support
ALTER TABLE source_model_citation_profile
  ADD COLUMN source_domain_id uuid REFERENCES source_domains(id) ON DELETE CASCADE;

ALTER TABLE source_model_citation_profile
  DROP CONSTRAINT source_model_citation_profile_family_id_model_name_observat_key;

CREATE UNIQUE INDEX uq_model_profile_family_level
  ON source_model_citation_profile (family_id, model_name, observation_window_start)
  WHERE source_domain_id IS NULL;

CREATE UNIQUE INDEX uq_model_profile_domain_level
  ON source_model_citation_profile (source_domain_id, model_name, observation_window_start)
  WHERE source_domain_id IS NOT NULL;

CREATE INDEX idx_model_profile_domain ON source_model_citation_profile(source_domain_id);

COMMENT ON COLUMN source_model_citation_profile.source_domain_id IS 'NULL = family-level rollup across all domain variants. Set = per-domain detail (e.g. glassdoor.de specifically).';

-- 4. Intelligence snapshots: dual-level support
ALTER TABLE source_intelligence_snapshots
  ADD COLUMN source_domain_id uuid REFERENCES source_domains(id) ON DELETE CASCADE;

ALTER TABLE source_intelligence_snapshots
  DROP CONSTRAINT source_intelligence_snapshots_family_id_snapshot_date_key;

CREATE UNIQUE INDEX uq_snapshot_family_level
  ON source_intelligence_snapshots (family_id, snapshot_date)
  WHERE source_domain_id IS NULL;

CREATE UNIQUE INDEX uq_snapshot_domain_level
  ON source_intelligence_snapshots (source_domain_id, snapshot_date)
  WHERE source_domain_id IS NOT NULL;

CREATE INDEX idx_snapshots_domain ON source_intelligence_snapshots(source_domain_id);

COMMENT ON COLUMN source_intelligence_snapshots.source_domain_id IS 'NULL = family-level snapshot (rollup). Set = per-domain snapshot.';
