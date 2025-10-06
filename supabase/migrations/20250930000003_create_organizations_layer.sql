-- Add Organizations layer on top of existing companies structure
-- Organizations = Agencies/Teams that manage multiple companies/clients

-- 1. Create organizations table (top level)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. Create organization_members (users in organizations)
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  is_default BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);

-- 3. Create organization_companies (companies/clients managed by organization)
CREATE TABLE IF NOT EXISTS organization_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(organization_id, company_id)
);

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_companies_org_id ON organization_companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_companies_company_id ON organization_companies(company_id);

-- 5. Add trigger for updated_at
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. Add RLS policies for organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and admins can update organizations"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Authenticated users can create organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 7. Add RLS for organization_members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org memberships"
  ON organization_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert org memberships"
  ON organization_members FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 8. Add RLS for organization_companies
ALTER TABLE organization_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their org companies"
  ON organization_companies FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage companies"
  ON organization_companies FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );

-- 9. Add admin bypass policies
CREATE POLICY "Admins can view all organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'karim@perceptionx.ai'::text);

CREATE POLICY "Admins can view all org members"
  ON organization_members FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'karim@perceptionx.ai'::text);

CREATE POLICY "Admins can view all org companies"
  ON organization_companies FOR SELECT
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'karim@perceptionx.ai'::text);

COMMENT ON TABLE organizations IS 'Top-level organizations (agencies/teams) that manage multiple companies/clients';
COMMENT ON TABLE organization_members IS 'Users who belong to organizations';
COMMENT ON TABLE organization_companies IS 'Companies/clients managed by an organization';


