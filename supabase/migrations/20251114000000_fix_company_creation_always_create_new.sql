-- ============================================================================
-- FIX: Always create new companies instead of reusing existing ones
-- ============================================================================
-- This migration fixes the bug where companies with the same name and industry
-- in the same organization were getting the same company ID. Now each company
-- will always get a unique ID regardless of name/industry matches.

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
    
    -- Always create a new company - don't check for existing ones
    -- Each company should have a unique ID even if name/industry match
    INSERT INTO companies (name, industry, company_size, competitors, created_by)
    VALUES (NEW.company_name, NEW.industry, NEW.company_size, NEW.competitors, NEW.user_id)
    RETURNING id INTO v_company_id;
    
    -- Link to organization
    INSERT INTO organization_companies (organization_id, company_id, added_by)
    VALUES (v_organization_id, v_company_id, NEW.user_id)
    ON CONFLICT (organization_id, company_id) DO NOTHING;
    
    -- Still maintain company_members for backwards compatibility
    SELECT EXISTS (
      SELECT 1 FROM company_members WHERE user_id = NEW.user_id AND is_default = true
    ) INTO v_has_default;
    
    INSERT INTO company_members (user_id, company_id, role, is_default)
    VALUES (NEW.user_id, v_company_id, 'owner', NOT v_has_default)
    ON CONFLICT (user_id, company_id) DO NOTHING;
    
    UPDATE user_onboarding SET company_id = v_company_id WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

