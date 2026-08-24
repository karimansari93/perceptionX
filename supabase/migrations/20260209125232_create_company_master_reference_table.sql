-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260209125232; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Company master reference table for canonical company data in the index
CREATE TABLE company_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  domain TEXT,
  logo_url TEXT,
  primary_color TEXT,
  branding_data JSONB,
  last_enriched_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Company variants for matching different name formats
CREATE TABLE company_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_master_id UUID REFERENCES company_master(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(variant_name)
);

-- Indexes for performance
CREATE INDEX idx_company_master_canonical ON company_master(canonical_name);
CREATE INDEX idx_company_master_domain ON company_master(domain);
CREATE INDEX idx_company_variants_name ON company_variants(LOWER(variant_name));
CREATE INDEX idx_company_variants_master_id ON company_variants(company_master_id);

-- Function to get canonical company name from variants
CREATE OR REPLACE FUNCTION get_canonical_company_name(raw_name TEXT)
RETURNS TEXT AS $$
DECLARE
  canonical TEXT;
BEGIN
  -- Try exact match on variants (case-insensitive)
  SELECT cm.canonical_name INTO canonical
  FROM company_variants cv
  JOIN company_master cm ON cv.company_master_id = cm.id
  WHERE LOWER(cv.variant_name) = LOWER(raw_name)
  LIMIT 1;
  
  -- If found, return canonical name
  IF canonical IS NOT NULL THEN
    RETURN canonical;
  END IF;
  
  -- Otherwise, apply basic cleaning and return
  RETURN clean_company_name(raw_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Enable RLS
ALTER TABLE company_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_variants ENABLE ROW LEVEL SECURITY;

-- RLS policies (read-only for anon, full access for authenticated)
CREATE POLICY "Allow public read access to company_master"
  ON company_master FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public read access to company_variants"
  ON company_variants FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service role has full access (for Edge Functions)
CREATE POLICY "Allow service role full access to company_master"
  ON company_master FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow service role full access to company_variants"
  ON company_variants FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

