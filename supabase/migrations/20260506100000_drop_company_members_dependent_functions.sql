-- Clean up database functions that referenced the dropped company_members
-- table. After we dropped company_members, these helpers were silently
-- breaking inserts and admin actions:
--
--   auto_link_prompts_trigger / auto_link_prompts_to_company
--     Fired on every confirmed_prompts insert, queried company_members
--     for the user's default company, errored "relation does not exist"
--     and rolled back the insert. This was the visibility flow's "0 prompts
--     created" symptom.
--
--   admin_delete_company
--     Built a diagnostic JSON of "deleted_counts" referencing 5 retired
--     tables (company_members, search_insights_*, company_search_terms,
--     user_onboarding). Rewritten to only count surviving tables.
--
--   create_company_with_membership / ensure_single_default_company /
--   get_user_default_company
--     Standalone RPCs with no remaining callers. Dropped.

DROP TRIGGER IF EXISTS auto_link_prompts_trigger ON public.confirmed_prompts;
DROP FUNCTION IF EXISTS public.auto_link_prompts_to_company();
DROP FUNCTION IF EXISTS public.create_company_with_membership;
DROP FUNCTION IF EXISTS public.ensure_single_default_company();
DROP FUNCTION IF EXISTS public.get_user_default_company();

CREATE OR REPLACE FUNCTION public.admin_delete_company(p_company_id uuid, p_organization_id uuid)
RETURNS TABLE(company_id uuid, organization_id uuid, company_name text, deleted_counts jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;
  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_companies oc
    WHERE oc.company_id = p_company_id AND oc.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Company is not associated with the specified organization';
  END IF;

  v_deleted_counts := jsonb_build_object(
    'organization_links', (SELECT COUNT(*) FROM organization_companies oc WHERE oc.company_id = p_company_id),
    'confirmed_prompts',  (SELECT COUNT(*) FROM confirmed_prompts cp WHERE cp.company_id = p_company_id),
    'prompt_responses',   (SELECT COUNT(*) FROM prompt_responses pr WHERE pr.company_id = p_company_id),
    'company_industries', (SELECT COUNT(*) FROM company_industries ci WHERE ci.company_id = p_company_id)
  );

  DELETE FROM companies WHERE companies.id = p_company_id;

  RETURN QUERY
  SELECT result_cols.col1, result_cols.col2, result_cols.col3, result_cols.col4
  FROM (
    SELECT
      p_company_id::UUID AS col1,
      p_organization_id::UUID AS col2,
      v_company_name::TEXT AS col3,
      v_deleted_counts::JSONB AS col4
  ) AS result_cols;
END;
$function$;
