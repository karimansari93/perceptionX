-- ============================================================================
-- FIX: Organization-Based Architecture
-- ============================================================================
-- This migration fixes the architecture to properly use organizations as the
-- primary membership layer, with companies belonging to organizations.

-- Step 1: Create organizations for existing users (backfill)
-- Each user gets their own organization based on their organization_name or first company
INSERT INTO organizations (name, created_by, created_at)
SELECT 
  COALESCE(
    (SELECT organization_name FROM user_onboarding 
     WHERE user_id = u.id 
     ORDER BY created_at ASC 
     LIMIT 1),
    (SELECT company_name FROM user_onboarding 
     WHERE user_id = u.id 
     ORDER BY created_at ASC 
     LIMIT 1),
    split_part(u.email, '@', 1) || '''s Organization'
  ),
  u.id,
  u.created_at
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members om WHERE om.user_id = u.id
);

-- Step 2: Add users to their organizations as owners
INSERT INTO organization_members (user_id, organization_id, role, is_default)
SELECT 
  u.id,
  o.id,
  'owner',
  true
FROM auth.users u
INNER JOIN organizations o ON o.created_by = u.id
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members om 
  WHERE om.user_id = u.id AND om.organization_id = o.id
);

-- Step 3: Link all existing companies to their user's organization
INSERT INTO organization_companies (organization_id, company_id, added_by)
SELECT DISTINCT
  om.organization_id,
  cm.company_id,
  cm.user_id
FROM company_members cm
INNER JOIN organization_members om ON om.user_id = cm.user_id AND om.is_default = true
WHERE NOT EXISTS (
  SELECT 1 FROM organization_companies oc 
  WHERE oc.organization_id = om.organization_id 
  AND oc.company_id = cm.company_id
);

-- Step 4: Update RLS policies to use organization membership instead of company membership

-- Drop existing policies that check company_members
DROP POLICY IF EXISTS "Users can view their company prompts" ON confirmed_prompts;
DROP POLICY IF EXISTS "Users can view responses for their companies" ON prompt_responses;
DROP POLICY IF EXISTS "Users can view their company responses" ON prompt_responses;
DROP POLICY IF EXISTS "Users can view search sessions for their companies" ON search_insights_sessions;
DROP POLICY IF EXISTS "Users can view search results for their companies" ON search_insights_results;
DROP POLICY IF EXISTS "Users can view search terms for their companies" ON search_insights_terms;

-- Create new policies that check organization membership
CREATE POLICY "Users can view prompts for their organization companies" ON confirmed_prompts
FOR SELECT USING (
  company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    INNER JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view responses for their organization companies" ON prompt_responses
FOR SELECT USING (
  company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    INNER JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view search sessions for their organization companies" ON search_insights_sessions
FOR SELECT USING (
  company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    INNER JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view search results for their organization companies" ON search_insights_results
FOR SELECT USING (
  company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    INNER JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view search terms for their organization companies" ON search_insights_terms
FOR SELECT USING (
  company_id IN (
    SELECT oc.company_id
    FROM organization_companies oc
    INNER JOIN organization_members om ON om.organization_id = oc.organization_id
    WHERE om.user_id = auth.uid()
  )
);

-- Step 5: Update the auto_create_company_from_onboarding trigger to work with organizations
DROP TRIGGER IF EXISTS auto_create_company_trigger ON user_onboarding;

CREATE OR REPLACE FUNCTION auto_create_company_from_onboarding()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
  v_organization_id UUID;
  v_has_default BOOLEAN;
BEGIN
  IF NEW.company_name IS NOT NULL AND NEW.industry IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    
    -- Get user's default organization
    SELECT organization_id INTO v_organization_id
    FROM organization_members
    WHERE user_id = NEW.user_id AND is_default = true
    LIMIT 1;
    
    -- Create organization if user doesn't have one
    IF v_organization_id IS NULL THEN
      INSERT INTO organizations (name, created_by)
      VALUES (COALESCE(NEW.organization_name, NEW.company_name || '''s Organization'), NEW.user_id)
      RETURNING id INTO v_organization_id;
      
      INSERT INTO organization_members (user_id, organization_id, role, is_default)
      VALUES (NEW.user_id, v_organization_id, 'owner', true);
    END IF;
    
    -- Check if company exists in this organization
    SELECT c.id INTO v_company_id
    FROM companies c
    INNER JOIN organization_companies oc ON oc.company_id = c.id
    WHERE c.name = NEW.company_name 
      AND c.industry = NEW.industry
      AND oc.organization_id = v_organization_id
    LIMIT 1;
    
    -- Create company if doesn't exist
    IF v_company_id IS NULL THEN
      INSERT INTO companies (name, industry, company_size, competitors, created_by)
      VALUES (NEW.company_name, NEW.industry, NEW.company_size, NEW.competitors, NEW.user_id)
      RETURNING id INTO v_company_id;
      
      -- Link to organization
      INSERT INTO organization_companies (organization_id, company_id, added_by)
      VALUES (v_organization_id, v_company_id, NEW.user_id);
      
      -- Still maintain company_members for backwards compatibility
      SELECT EXISTS (
        SELECT 1 FROM company_members WHERE user_id = NEW.user_id AND is_default = true
      ) INTO v_has_default;
      
      INSERT INTO company_members (user_id, company_id, role, is_default)
      VALUES (NEW.user_id, v_company_id, 'owner', NOT v_has_default);
    END IF;
    
    UPDATE user_onboarding SET company_id = v_company_id WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_create_company_trigger
  AFTER INSERT ON user_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_company_from_onboarding();

-- Step 6: Create helper function to get user's organization companies
CREATE OR REPLACE FUNCTION get_user_organization_companies(p_user_id UUID)
RETURNS TABLE(company_id UUID, company_name TEXT, is_default BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as company_id,
    c.name as company_name,
    COALESCE(cm.is_default, false) as is_default
  FROM companies c
  INNER JOIN organization_companies oc ON oc.company_id = c.id
  INNER JOIN organization_members om ON om.organization_id = oc.organization_id
  LEFT JOIN company_members cm ON cm.company_id = c.id AND cm.user_id = p_user_id
  WHERE om.user_id = p_user_id
  ORDER BY cm.is_default DESC, c.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Create helper function to get user's default organization
CREATE OR REPLACE FUNCTION get_user_default_organization(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  SELECT organization_id INTO v_organization_id
  FROM organization_members
  WHERE user_id = p_user_id AND is_default = true
  LIMIT 1;
  
  -- If no default, return first organization
  IF v_organization_id IS NULL THEN
    SELECT organization_id INTO v_organization_id
    FROM organization_members
    WHERE user_id = p_user_id
    ORDER BY joined_at ASC
    LIMIT 1;
  END IF;
  
  RETURN v_organization_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_organization_members_user_default 
  ON organization_members(user_id, is_default) 
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_organization_companies_org_company 
  ON organization_companies(organization_id, company_id);

-- Step 9: Add comments
COMMENT ON FUNCTION get_user_organization_companies IS 'Returns all companies accessible to a user through their organization membership';
COMMENT ON FUNCTION get_user_default_organization IS 'Returns the user''s default organization ID';
