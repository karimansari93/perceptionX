-- Add admin-only helper to delete a company and cascade all related data
-- This function ensures the caller is an admin and that the company is tied to the supplied organization

CREATE OR REPLACE FUNCTION admin_delete_company(
  p_company_id UUID,
  p_organization_id UUID
)
RETURNS TABLE (
  company_id UUID,
  organization_id UUID,
  company_name TEXT,
  deleted_counts JSONB
) AS $$
DECLARE
  v_company_name TEXT;
  v_deleted_counts JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin privileges required';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  -- Ensure the company exists
  SELECT name INTO v_company_name
  FROM companies
  WHERE id = p_company_id;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- Ensure the company is linked to the provided organization
  IF NOT EXISTS (
    SELECT 1
    FROM organization_companies oc
    WHERE oc.company_id = p_company_id
      AND oc.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Company is not associated with the specified organization';
  END IF;

  -- Capture counts for reporting back to the caller
  v_deleted_counts := jsonb_build_object(
    'company_members',       (SELECT COUNT(*) FROM company_members cm WHERE cm.company_id = p_company_id),
    'organization_links',    (SELECT COUNT(*) FROM organization_companies oc WHERE oc.company_id = p_company_id),
    'confirmed_prompts',     (SELECT COUNT(*) FROM confirmed_prompts cp WHERE cp.company_id = p_company_id),
    'prompt_responses',      (SELECT COUNT(*) FROM prompt_responses pr WHERE pr.company_id = p_company_id),
    'search_insights',       (SELECT COUNT(*) FROM search_insights_sessions sis WHERE sis.company_id = p_company_id),
    'search_results',        (SELECT COUNT(*) FROM search_insights_results sir WHERE sir.company_id = p_company_id),
    'search_terms',          (SELECT COUNT(*) FROM search_insights_terms sit WHERE sit.company_id = p_company_id),
    'company_search_terms',  (SELECT COUNT(*) FROM company_search_terms cst WHERE cst.company_id = p_company_id),
    'company_industries',    (SELECT COUNT(*) FROM company_industries ci WHERE ci.company_id = p_company_id),
    'user_onboarding',      (SELECT COUNT(*) FROM user_onboarding uo WHERE uo.company_id = p_company_id)
  );

  -- First, set company_id to NULL in user_onboarding to avoid foreign key constraint violation
  -- This preserves the onboarding records but unlinks them from the company
  -- Use dynamic SQL to avoid ambiguity between RETURNS TABLE column and table column
  EXECUTE 'UPDATE user_onboarding SET company_id = NULL WHERE company_id = $1'
    USING p_company_id;

  -- Delete the company (cascades handle related tables)
  DELETE FROM companies
  WHERE companies.id = p_company_id;

  -- Return the result - use a subquery to isolate and avoid column name ambiguity
  RETURN QUERY
  SELECT 
    result_cols.col1, 
    result_cols.col2, 
    result_cols.col3, 
    result_cols.col4
  FROM (
    SELECT 
      p_company_id::UUID AS col1,
      p_organization_id::UUID AS col2,
      v_company_name::TEXT AS col3,
      v_deleted_counts::JSONB AS col4
  ) AS result_cols;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION admin_delete_company(UUID, UUID) TO authenticated;


