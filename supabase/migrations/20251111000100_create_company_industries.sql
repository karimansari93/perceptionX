-- Create supporting table for multiple industries per company
CREATE TABLE IF NOT EXISTS company_industries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  industry TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, industry)
);

-- Enable row level security
ALTER TABLE company_industries ENABLE ROW LEVEL SECURITY;

-- Allow any company member to view industries for their companies
CREATE POLICY "Members can view company industries"
  ON company_industries FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM company_members
      WHERE user_id = auth.uid()
    )
  );

-- Allow owners and admins to manage industries
CREATE POLICY "Owners and admins manage company industries"
  ON company_industries FOR ALL
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM company_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM company_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Backfill existing company industries so every company has at least one entry
INSERT INTO company_industries (company_id, industry, created_by)
SELECT id, industry, created_by
FROM companies
WHERE industry IS NOT NULL
ON CONFLICT (company_id, industry) DO NOTHING;

