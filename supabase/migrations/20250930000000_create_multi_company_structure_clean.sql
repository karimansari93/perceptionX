-- Create multi-company structure for PerceptionX
-- This migration enables users to belong to multiple companies and switch between them

-- 1. Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  company_size TEXT,
  competitors TEXT[] DEFAULT '{}',
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. Create company_members junction table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS company_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  is_default BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(user_id, company_id)
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);
CREATE INDEX IF NOT EXISTS idx_companies_created_at ON companies(created_at);
CREATE INDEX IF NOT EXISTS idx_company_members_user_id ON company_members(user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company_id ON company_members(company_id);
CREATE INDEX IF NOT EXISTS idx_company_members_default ON company_members(user_id, is_default) WHERE is_default = true;

-- 4. Add triggers for updated_at
CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Add company_id to existing tables (keeping user_id for audit trail)
ALTER TABLE confirmed_prompts 
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

ALTER TABLE search_insights_sessions 
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- 6. Create indexes on new company_id columns
CREATE INDEX IF NOT EXISTS idx_confirmed_prompts_company_id ON confirmed_prompts(company_id);
CREATE INDEX IF NOT EXISTS idx_search_insights_sessions_company_id ON search_insights_sessions(company_id);

-- 7. Add RLS (Row Level Security) policies for companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Users can see companies they are members of
CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid()
    )
  );

-- Only owners and admins can update companies
CREATE POLICY "Owners and admins can update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );

-- Only owners can delete companies
CREATE POLICY "Owners can delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING (
    id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid() 
      AND role = 'owner'
    )
  );

-- Anyone authenticated can create a company (they become the owner)
CREATE POLICY "Authenticated users can create companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 8. Add RLS policies for company_members
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

-- Users can see members of their companies
CREATE POLICY "Users can view members of their companies"
  ON company_members FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid()
    )
  );

-- Owners and admins can add members
CREATE POLICY "Owners and admins can add members"
  ON company_members FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );

-- Owners and admins can update members
CREATE POLICY "Owners and admins can update members"
  ON company_members FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );

-- Owners and admins can remove members (except owners can't be removed)
CREATE POLICY "Owners and admins can remove members"
  ON company_members FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
    AND role != 'owner'
  );

-- 9. Update RLS policies for confirmed_prompts to use company_id
DROP POLICY IF EXISTS "Users can view their own prompts" ON confirmed_prompts;
CREATE POLICY "Users can view their company prompts"
  ON confirmed_prompts FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM company_members 
      WHERE user_id = auth.uid()
    )
  );

-- 10. Create function to ensure only one default company per user
CREATE OR REPLACE FUNCTION ensure_single_default_company()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    -- Set all other companies for this user to not default
    UPDATE company_members
    SET is_default = false
    WHERE user_id = NEW.user_id
    AND company_id != NEW.company_id
    AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_single_default_company
  BEFORE INSERT OR UPDATE ON company_members
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_company();

-- 11. Create helper function to get user's default company
CREATE OR REPLACE FUNCTION get_user_default_company(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT company_id INTO v_company_id
  FROM company_members
  WHERE user_id = p_user_id AND is_default = true
  LIMIT 1;
  
  -- If no default, return first company
  IF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id
    FROM company_members
    WHERE user_id = p_user_id
    ORDER BY joined_at ASC
    LIMIT 1;
  END IF;
  
  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE companies IS 'Stores company/organization information';
COMMENT ON TABLE company_members IS 'Junction table for many-to-many relationship between users and companies';
COMMENT ON COLUMN company_members.role IS 'User role in the company: owner (full control), admin (manage members), member (read/write)';
COMMENT ON COLUMN company_members.is_default IS 'The company shown by default when user logs in';


