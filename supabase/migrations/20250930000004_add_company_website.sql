-- Add website field to companies table for favicon/logo display

ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS website TEXT;

-- Create index for website lookups
CREATE INDEX IF NOT EXISTS idx_companies_website ON companies(website);

-- Helper function to derive domain from company name (fallback)
CREATE OR REPLACE FUNCTION get_company_domain(company_name TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Convert company name to potential domain
  -- e.g., "Netflix" -> "netflix.com", "T Rowe Price" -> "troweprice.com"
  RETURN LOWER(REGEXP_REPLACE(company_name, '[^a-zA-Z0-9]', '', 'g')) || '.com';
END;
$$ LANGUAGE plpgsql;

-- Update existing companies with derived domains (you can manually update these later)
UPDATE companies
SET website = get_company_domain(name)
WHERE website IS NULL;

COMMENT ON COLUMN companies.website IS 'Company website domain (e.g., netflix.com) for favicon/logo display';


