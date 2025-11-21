-- ============================================================================
-- FIX: Identify and fix duplicate company data
-- ============================================================================
-- This migration helps identify companies that incorrectly share the same ID
-- and provides functions to fix the data by creating new companies and reassigning records

-- Step 1: Create a function to identify duplicate companies
-- (Companies with same name/industry in same org that should be separate)
CREATE OR REPLACE FUNCTION identify_duplicate_companies()
RETURNS TABLE(
  company_id UUID,
  company_name TEXT,
  industry TEXT,
  organization_id UUID,
  onboarding_count BIGINT,
  onboarding_ids UUID[],
  countries TEXT[],
  created_dates TIMESTAMPTZ[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.industry,
    oc.organization_id,
    COUNT(DISTINCT uo.id) as onboarding_count,
    ARRAY_AGG(DISTINCT uo.id) as onboarding_ids,
    ARRAY_AGG(DISTINCT uo.country) FILTER (WHERE uo.country IS NOT NULL) as countries,
    ARRAY_AGG(DISTINCT uo.created_at ORDER BY uo.created_at) as created_dates
  FROM companies c
  INNER JOIN organization_companies oc ON oc.company_id = c.id
  INNER JOIN user_onboarding uo ON uo.company_id = c.id
  WHERE uo.company_name = c.name 
    AND uo.industry = c.industry
  GROUP BY c.id, c.name, c.industry, oc.organization_id
  HAVING COUNT(DISTINCT uo.id) > 1
  ORDER BY onboarding_count DESC, c.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Create a function to fix duplicate companies by creating new ones
-- This will create a new company for each duplicate onboarding record
CREATE OR REPLACE FUNCTION fix_duplicate_company(
  p_duplicate_company_id UUID,
  p_onboarding_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_new_company_id UUID;
  v_organization_id UUID;
  v_onboarding_record RECORD;
  v_has_default BOOLEAN;
BEGIN
  -- Get the onboarding record details
  SELECT * INTO v_onboarding_record
  FROM user_onboarding
  WHERE id = p_onboarding_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onboarding record not found: %', p_onboarding_id;
  END IF;
  
  -- Get organization_id from the existing company
  SELECT oc.organization_id INTO v_organization_id
  FROM organization_companies oc
  WHERE oc.company_id = p_duplicate_company_id
  LIMIT 1;
  
  IF v_organization_id IS NULL THEN
    -- Get user's default organization
    SELECT organization_id INTO v_organization_id
    FROM organization_members
    WHERE user_id = v_onboarding_record.user_id AND is_default = true
    LIMIT 1;
    
    -- Create organization if user doesn't have one
    IF v_organization_id IS NULL THEN
      INSERT INTO organizations (name, created_by)
      VALUES (COALESCE(v_onboarding_record.organization_name, v_onboarding_record.company_name || '''s Organization'), v_onboarding_record.user_id)
      RETURNING id INTO v_organization_id;
      
      INSERT INTO organization_members (user_id, organization_id, role, is_default)
      VALUES (v_onboarding_record.user_id, v_organization_id, 'owner', true);
    END IF;
  END IF;
  
  -- Create a new company for this onboarding record
  INSERT INTO companies (name, industry, company_size, competitors, created_by, created_at)
  VALUES (
    v_onboarding_record.company_name,
    v_onboarding_record.industry,
    v_onboarding_record.company_size,
    v_onboarding_record.competitors,
    v_onboarding_record.user_id,
    v_onboarding_record.created_at
  )
  RETURNING id INTO v_new_company_id;
  
  -- Link to organization
  INSERT INTO organization_companies (organization_id, company_id, added_by)
  VALUES (v_organization_id, v_new_company_id, v_onboarding_record.user_id)
  ON CONFLICT (organization_id, company_id) DO NOTHING;
  
  -- Create company membership
  SELECT EXISTS (
    SELECT 1 FROM company_members WHERE user_id = v_onboarding_record.user_id AND is_default = true
  ) INTO v_has_default;
  
  INSERT INTO company_members (user_id, company_id, role, is_default)
  VALUES (v_onboarding_record.user_id, v_new_company_id, 'owner', NOT v_has_default)
  ON CONFLICT (user_id, company_id) DO NOTHING;
  
  -- Update the onboarding record to point to the new company
  UPDATE user_onboarding 
  SET company_id = v_new_company_id 
  WHERE id = p_onboarding_id;
  
  -- Reassign all data linked to this onboarding record to the new company
  -- Update confirmed_prompts
  UPDATE confirmed_prompts
  SET company_id = v_new_company_id
  WHERE onboarding_id = p_onboarding_id
    AND company_id = p_duplicate_company_id;
  
  -- Update search_insights_sessions (match by onboarding_id via user_onboarding)
  UPDATE search_insights_sessions
  SET company_id = v_new_company_id
  WHERE user_id = v_onboarding_record.user_id
    AND company_name = v_onboarding_record.company_name
    AND company_id = p_duplicate_company_id
    AND created_at >= v_onboarding_record.created_at
    AND created_at <= v_onboarding_record.created_at + INTERVAL '1 hour'; -- Within 1 hour of onboarding
  
  -- Update search_insights_results (via sessions)
  UPDATE search_insights_results
  SET company_id = v_new_company_id
  WHERE company_id = p_duplicate_company_id
    AND session_id IN (
      SELECT id FROM search_insights_sessions 
      WHERE company_id = v_new_company_id
        AND user_id = v_onboarding_record.user_id
    );
  
  -- Update search_insights_terms (via sessions)
  UPDATE search_insights_terms
  SET company_id = v_new_company_id
  WHERE company_id = p_duplicate_company_id
    AND session_id IN (
      SELECT id FROM search_insights_sessions 
      WHERE company_id = v_new_company_id
        AND user_id = v_onboarding_record.user_id
    );
  
  -- Update prompt_responses (via confirmed_prompts)
  UPDATE prompt_responses
  SET company_id = v_new_company_id
  WHERE company_id = p_duplicate_company_id
    AND confirmed_prompt_id IN (
      SELECT id FROM confirmed_prompts 
      WHERE company_id = v_new_company_id
    );
  
  RETURN v_new_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Create a helper view to see duplicate companies
CREATE OR REPLACE VIEW duplicate_companies_view AS
SELECT 
  c.id as company_id,
  c.name as company_name,
  c.industry,
  oc.organization_id,
  COUNT(DISTINCT uo.id) as duplicate_count,
  ARRAY_AGG(DISTINCT uo.id ORDER BY uo.created_at) as onboarding_ids,
  ARRAY_AGG(DISTINCT uo.country ORDER BY uo.country) FILTER (WHERE uo.country IS NOT NULL) as countries,
  MIN(uo.created_at) as first_created,
  MAX(uo.created_at) as last_created
FROM companies c
INNER JOIN organization_companies oc ON oc.company_id = c.id
INNER JOIN user_onboarding uo ON uo.company_id = c.id
WHERE uo.company_name = c.name 
  AND uo.industry = c.industry
GROUP BY c.id, c.name, c.industry, oc.organization_id
HAVING COUNT(DISTINCT uo.id) > 1;

-- Add comments
COMMENT ON FUNCTION identify_duplicate_companies IS 'Identifies companies that incorrectly share the same ID due to the duplicate bug';
COMMENT ON FUNCTION fix_duplicate_company IS 'Creates a new company for a duplicate onboarding record and reassigns all related data';
COMMENT ON VIEW duplicate_companies_view IS 'Shows all companies that have duplicate onboarding records (should be separate companies)';

