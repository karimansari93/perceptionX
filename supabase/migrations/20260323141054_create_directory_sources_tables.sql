-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260323141054; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- PERCEPTIONX: Citation Source Directory
-- Two-table design:
--   1. directory_sources       — source metadata (global)
--   2. directory_source_scores — per-country weighted scores
-- ============================================================

CREATE TABLE IF NOT EXISTS directory_sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain                text NOT NULL UNIQUE,
  name                  text NOT NULL,
  source_type           text NOT NULL,         -- e.g. 'Review Platform', 'Business News', 'Community'
  category              text NOT NULL,         -- e.g. 'review', 'news', 'jobs', 'community', 'rankings', 'reference', 'social', 'compensation'
  description           text,
  best_for              text,                  -- short label, e.g. 'Sentiment baseline'
  use_cases             text[]  DEFAULT '{}',  -- e.g. ARRAY['Culture perception','CEO approval']
  tracked_signals       jsonb   DEFAULT '[]',  -- ARRAY of {name, description, example_value}
  primary_prompt_types  text[]  DEFAULT '{}',  -- e.g. ARRAY['discovery','experience','competitive']
  primary_themes        text[]  DEFAULT '{}',  -- e.g. ARRAY['Compensation','Leadership','Culture']
  country_focus         text[]  DEFAULT '{}',  -- empty = global; else specific markets e.g. ARRAY['Germany']
  nuances               text,                  -- free-text notes on quirks / caveats
  global_citation_count integer DEFAULT 0,
  is_active             boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Per-country scores (one row per source × country)
CREATE TABLE IF NOT EXISTS directory_source_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      uuid NOT NULL REFERENCES directory_sources(id) ON DELETE CASCADE,
  country        text NOT NULL,                -- 'GLOBAL' or ISO/display name e.g. 'Germany'
  authority      integer CHECK (authority BETWEEN 0 AND 100),
  evi_weight     integer CHECK (evi_weight BETWEEN 0 AND 100),
  citation_rate  integer CHECK (citation_rate BETWEEN 0 AND 100),
  citation_count integer DEFAULT 0,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (source_id, country)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_directory_sources_category      ON directory_sources(category);
CREATE INDEX IF NOT EXISTS idx_directory_sources_source_type   ON directory_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_directory_source_scores_source  ON directory_source_scores(source_id);
CREATE INDEX IF NOT EXISTS idx_directory_source_scores_country ON directory_source_scores(country);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_directory_sources_updated_at       ON directory_sources;
DROP TRIGGER IF EXISTS trg_directory_source_scores_updated_at ON directory_source_scores;

CREATE TRIGGER trg_directory_sources_updated_at
  BEFORE UPDATE ON directory_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_directory_source_scores_updated_at
  BEFORE UPDATE ON directory_source_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE directory_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_source_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read directory_sources"
  ON directory_sources FOR SELECT USING (true);

CREATE POLICY "Public read directory_source_scores"
  ON directory_source_scores FOR SELECT USING (true);

