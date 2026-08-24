-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260504110235; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Source Intelligence Foundation
-- 10 new tables for canonical source classification + per-URL enrichment.
-- Purely additive. Existing app continues to read from directory_sources.

-- 1. Taxonomy (3-level hierarchy)
CREATE TABLE source_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  super_category text NOT NULL,
  category text,
  subcategory text,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  sort_order integer DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_taxonomy_super ON source_taxonomy(super_category);
CREATE INDEX idx_taxonomy_category ON source_taxonomy(category);

INSERT INTO source_taxonomy (super_category, slug, display_name, sort_order, description) VALUES
  ('Owned', 'owned', 'Owned', 10, 'Domains controlled by the company itself (career site, blog, newsroom).'),
  ('Employer Review', 'employer_review', 'Employer Review', 20, 'Sites where current/former employees rate companies.'),
  ('Compensation Data', 'compensation', 'Compensation Data', 30, 'Sites that publish salary, equity, or compensation benchmarks.'),
  ('Community & Social', 'community_social', 'Community & Social', 40, 'Forums, social platforms, and user-driven discussion.'),
  ('Editorial & News', 'editorial_news', 'Editorial & News', 50, 'News outlets, business media, and editorial publications.'),
  ('Job Boards & Aggregators', 'job_boards', 'Job Boards & Aggregators', 60, 'Sites listing open roles aggregated across employers.'),
  ('Rankings & Lists', 'rankings', 'Rankings & Lists', 70, 'Sites publishing employer rankings, awards, and best-of lists.'),
  ('Reference & Wikis', 'reference', 'Reference & Wikis', 80, 'Reference sources like Wikipedia, Crunchbase, knowledge bases.'),
  ('Recruitment & HR Vendors', 'hr_vendors', 'Recruitment & HR Vendors', 90, 'Recruitment agencies, ATS providers, HR services.');

-- 2. Source Families (canonical entity)
CREATE TABLE source_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  taxonomy_id uuid REFERENCES source_taxonomy(id) ON DELETE SET NULL,
  parent_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  homepage_url text,
  dominant_languages text[] DEFAULT ARRAY[]::text[],
  primary_regions text[] DEFAULT ARRAY[]::text[],
  authority_score numeric(5,2),
  ai_visibility_score numeric(5,2),
  has_api boolean DEFAULT false,
  has_company_dashboard boolean DEFAULT false,
  accepts_company_responses boolean DEFAULT false,
  intelligence jsonb DEFAULT '{}'::jsonb,
  last_intelligence_refresh_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_families_taxonomy ON source_families(taxonomy_id);
CREATE INDEX idx_families_parent_company ON source_families(parent_company_id);

-- 3. Source Domains (surface variants)
CREATE TABLE source_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  family_id uuid REFERENCES source_families(id) ON DELETE CASCADE,
  registrable_domain text,
  region text,
  language text,
  is_canonical boolean DEFAULT false,
  classification_method text CHECK (classification_method IN ('manual','etld_rollup','pattern','llm','whois','imported')),
  classification_confidence numeric(3,2) CHECK (classification_confidence BETWEEN 0 AND 1),
  classification_model_version text,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz,
  occurrence_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_domains_family ON source_domains(family_id);
CREATE INDEX idx_domains_registrable ON source_domains(registrable_domain);

-- 4. Cited URL Classifications (per-URL enrichment, keyed by hash)
CREATE TABLE cited_url_classifications (
  url_hash text PRIMARY KEY,
  url text NOT NULL,
  normalized_url text NOT NULL,
  domain text,
  family_id uuid REFERENCES source_families(id) ON DELETE SET NULL,
  page_intent text,
  subject_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  is_owned_by_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  language_detected text,
  classified_at timestamptz DEFAULT now(),
  classified_by_model text
);
CREATE INDEX idx_cited_url_domain ON cited_url_classifications(domain);
CREATE INDEX idx_cited_url_family ON cited_url_classifications(family_id);
CREATE INDEX idx_cited_url_subject ON cited_url_classifications(subject_company_id);
CREATE INDEX idx_cited_url_owned ON cited_url_classifications(is_owned_by_company_id);
CREATE INDEX idx_cited_url_intent ON cited_url_classifications(page_intent);

-- 5. Homepage Enrichment (one row per family)
CREATE TABLE source_homepage_enrichment (
  family_id uuid PRIMARY KEY REFERENCES source_families(id) ON DELETE CASCADE,
  fetched_at timestamptz,
  http_status integer,
  redirect_chain text[],
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

-- 6. Per-Model Citation Profile (empirical, replaces robots.txt guesswork)
CREATE TABLE source_model_citation_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES source_families(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  citation_count integer DEFAULT 0,
  citation_share numeric(5,4),
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  observation_window_start timestamptz,
  observation_window_end timestamptz,
  computed_at timestamptz DEFAULT now(),
  UNIQUE(family_id, model_name, observation_window_start)
);
CREATE INDEX idx_model_profile_family ON source_model_citation_profile(family_id);
CREATE INDEX idx_model_profile_model ON source_model_citation_profile(model_name);

-- 7. Intelligence Snapshots (time-series, drift detection)
CREATE TABLE source_intelligence_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES source_families(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  global_citation_count integer DEFAULT 0,
  global_citation_share numeric(5,4),
  citation_share_delta_30d numeric(5,4),
  dominant_themes jsonb DEFAULT '[]'::jsonb,
  top_models jsonb DEFAULT '[]'::jsonb,
  computed_at timestamptz DEFAULT now(),
  UNIQUE(family_id, snapshot_date)
);
CREATE INDEX idx_snapshots_family ON source_intelligence_snapshots(family_id);
CREATE INDEX idx_snapshots_date ON source_intelligence_snapshots(snapshot_date);

-- 8. Classification History (audit log)
CREATE TABLE source_classification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES source_families(id) ON DELETE SET NULL,
  source_domain_id uuid REFERENCES source_domains(id) ON DELETE SET NULL,
  changed_at timestamptz DEFAULT now(),
  changed_by text,
  change_type text CHECK (change_type IN ('created','recategorized','merged','split','enriched','deprecated')),
  before jsonb,
  after jsonb,
  reason text
);
CREATE INDEX idx_history_family ON source_classification_history(family_id);
CREATE INDEX idx_history_domain ON source_classification_history(source_domain_id);
CREATE INDEX idx_history_changed_at ON source_classification_history(changed_at DESC);

-- 9. Review Queue
CREATE TABLE source_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  suggested_family_id uuid REFERENCES source_families(id) ON DELETE SET NULL,
  suggested_taxonomy_id uuid REFERENCES source_taxonomy(id) ON DELETE SET NULL,
  confidence numeric(3,2),
  llm_reasoning text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','merged')),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_review_queue_status ON source_review_queue(status);
CREATE INDEX idx_review_queue_domain ON source_review_queue(domain);

-- 10. Company Owned Domain Patterns
CREATE TABLE company_owned_domain_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pattern_type text NOT NULL CHECK (pattern_type IN ('subdomain_exact','subdomain_wildcard','path_prefix','host_exact')),
  pattern_value text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, pattern_type, pattern_value)
);
CREATE INDEX idx_owned_patterns_company ON company_owned_domain_patterns(company_id);

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION trg_source_intel_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_taxonomy BEFORE UPDATE ON source_taxonomy
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();
CREATE TRIGGER set_updated_at_families BEFORE UPDATE ON source_families
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();
CREATE TRIGGER set_updated_at_domains BEFORE UPDATE ON source_domains
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();
CREATE TRIGGER set_updated_at_homepage BEFORE UPDATE ON source_homepage_enrichment
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();
CREATE TRIGGER set_updated_at_patterns BEFORE UPDATE ON company_owned_domain_patterns
  FOR EACH ROW EXECUTE FUNCTION trg_source_intel_set_updated_at();

COMMENT ON TABLE source_taxonomy IS 'Three-level source taxonomy: super_category > category > subcategory.';
COMMENT ON TABLE source_families IS 'Canonical source entity. One row per logical source (e.g., Glassdoor) regardless of country variants.';
COMMENT ON TABLE source_domains IS 'Every domain variant that resolves to a family. ie.glassdoor.com, glassdoor.de, etc., all point to the Glassdoor family.';
COMMENT ON TABLE cited_url_classifications IS 'Per-URL enrichment. Keyed by sha256(normalized_url) for idempotent reruns.';
COMMENT ON TABLE source_homepage_enrichment IS 'One-time fetch of homepage metadata + WHOIS + SSL per family. Refreshed quarterly.';
COMMENT ON TABLE source_model_citation_profile IS 'Empirical per-AI-model citation behavior derived from prompt_responses. Replaces robots.txt-based crawler-policy guesses.';
COMMENT ON TABLE source_intelligence_snapshots IS 'Weekly snapshot of family-level citation share and theme association. Powers drift detection.';
COMMENT ON TABLE source_classification_history IS 'Append-only audit log of every classification change.';
COMMENT ON TABLE source_review_queue IS 'Low-confidence classifications queued for manual review.';
COMMENT ON TABLE company_owned_domain_patterns IS 'Per-company subdomain/path patterns for owned-domain matching. Wildcards supported (e.g. *.netflix.com).';
