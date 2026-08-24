-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260409113501; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- New table: company_owned_domains
-- Tracks domains owned/operated by a specific company
-- These are excluded from the directory (which is for third-party platforms only)
-- but surfaced as a separate "your owned assets in AI citations" insight

CREATE TABLE IF NOT EXISTS company_owned_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  domain text NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN (
    'careers',        -- jobs.netflix.com, careers.google.com
    'corporate',      -- about.netflix.com, microsoft.com
    'tech_blog',      -- netflixtechblog.com, engineering.atspotify.com
    'support',        -- help.netflix.com, support.gofundme.com
    'investor',       -- ir.netflix.net
    'product',        -- gofundme.com (the product IS the brand)
    'regional',       -- es.cloudera.com, de.about.netflix.com
    'social',         -- company-owned social handles (if tracked by domain)
    'other'
  )),
  is_auto_detected boolean DEFAULT false,  -- true if detected from citation data vs manually added
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, domain)
);

COMMENT ON TABLE company_owned_domains IS 
  'Domains owned or operated by a specific company. Excluded from the third-party source directory. 
   Used to identify when AI is citing a company''s own assets vs. third-party coverage.';

-- Also add a flag to directory_sources to explicitly exclude company-specific domains
-- that may have crept in (belt and suspenders)
ALTER TABLE directory_sources 
  ADD COLUMN IF NOT EXISTS is_company_owned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_company_id uuid REFERENCES companies(id);

COMMENT ON COLUMN directory_sources.is_company_owned IS 
  'If true, this domain is a company-owned asset and should not appear in the public directory';

