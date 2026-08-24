-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260323141441; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- TABLE 1: directory_sources
-- Master list of citation sources with full metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS directory_sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain                text NOT NULL UNIQUE,
  name                  text NOT NULL,
  source_type           text NOT NULL, -- 'Review Platform', 'Job Aggregator', 'Rankings & Lists', 'Business News', 'Tech Media', 'Community Forum', 'Compensation Data', 'Professional Network', 'Reference', 'Social Media', 'Startup Directory'
  category              text NOT NULL, -- 'review', 'jobs', 'rankings', 'news', 'community', 'compensation', 'social', 'reference'
  description           text,
  best_for              text,          -- short label e.g. "Sentiment baseline"
  use_cases             text[],        -- e.g. ARRAY['Culture perception', 'CEO approval']
  tracked_signals       jsonb,         -- array of {name, description, example_value}
  primary_prompt_types  text[],        -- e.g. ARRAY['experience', 'competitive', 'discovery']
  primary_themes        text[],        -- e.g. ARRAY['Leadership', 'Compensation', 'Culture']
  nuances               text,          -- any important caveats or notes
  country_focus         text[],        -- NULL = global, else e.g. ARRAY['Germany']
  is_active             boolean DEFAULT true,
  global_citation_count integer DEFAULT 0,  -- populated from prompt_responses
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE 2: directory_source_scores
-- Per-country authority, EVI weight, citation rate scores
-- ============================================================
CREATE TABLE IF NOT EXISTS directory_source_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid NOT NULL REFERENCES directory_sources(id) ON DELETE CASCADE,
  country           text NOT NULL,  -- 'global', 'United States', 'United Kingdom', 'Germany', etc.
  authority_score   integer CHECK (authority_score BETWEEN 0 AND 100),
  evi_weight        integer CHECK (evi_weight BETWEEN 0 AND 100),
  citation_rate     integer CHECK (citation_rate BETWEEN 0 AND 100),  -- % of relevant prompts where this source appears
  citation_count    integer DEFAULT 0,  -- raw count for this country
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (source_id, country)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_directory_sources_category ON directory_sources(category);
CREATE INDEX IF NOT EXISTS idx_directory_sources_source_type ON directory_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_directory_sources_country_focus ON directory_sources USING GIN(country_focus);
CREATE INDEX IF NOT EXISTS idx_directory_source_scores_source_id ON directory_source_scores(source_id);
CREATE INDEX IF NOT EXISTS idx_directory_source_scores_country ON directory_source_scores(country);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_directory_sources_updated_at ON directory_sources;
CREATE TRIGGER set_directory_sources_updated_at
  BEFORE UPDATE ON directory_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_directory_source_scores_updated_at ON directory_source_scores;
CREATE TRIGGER set_directory_source_scores_updated_at
  BEFORE UPDATE ON directory_source_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE directory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_source_scores ENABLE ROW LEVEL SECURITY;

-- Read-only public access (same pattern as your other public tables)
CREATE POLICY "Public read access on directory_sources"
  ON directory_sources FOR SELECT USING (true);

CREATE POLICY "Public read access on directory_source_scores"
  ON directory_source_scores FOR SELECT USING (true);

