-- Unify all per-company RLS policies onto organization_members.
--
-- Previously, ~17 RLS policies gated reads/writes on company_members,
-- which was a parallel/legacy access model. After org_members became the
-- canonical access model, those policies stayed pointed at the dead
-- table — meaning users added to an org via the admin UI silently
-- couldn't read/write their org's data, table by table.
--
-- This migration:
--   1. Adds two helper functions (user_can_access_company,
--      user_can_admin_company) so future policies have one place to gate.
--   2. Rewrites every per-company policy to call those helpers.

CREATE OR REPLACE FUNCTION public.user_can_access_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM organization_companies oc
      JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE oc.company_id = p_company_id
        AND om.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.user_can_admin_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM organization_companies oc
      JOIN organization_members om ON om.organization_id = oc.organization_id
      WHERE oc.company_id = p_company_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner','admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_company(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_can_admin_company(uuid) TO authenticated, anon;

-- ===== companies =====
DROP POLICY IF EXISTS "Users can view their companies" ON public.companies;
DROP POLICY IF EXISTS companies_update_policy ON public.companies;
DROP POLICY IF EXISTS companies_delete_policy ON public.companies;

CREATE POLICY companies_select_policy ON public.companies
  FOR SELECT USING (user_can_access_company(id));
CREATE POLICY companies_update_policy ON public.companies
  FOR UPDATE USING (user_can_admin_company(id));
CREATE POLICY companies_delete_policy ON public.companies
  FOR DELETE USING (user_can_admin_company(id));

-- ===== company_industries =====
DROP POLICY IF EXISTS company_industries_select_policy ON public.company_industries;
DROP POLICY IF EXISTS company_industries_update_policy ON public.company_industries;
DROP POLICY IF EXISTS company_industries_delete_policy ON public.company_industries;

CREATE POLICY company_industries_select_policy ON public.company_industries
  FOR SELECT USING (user_can_access_company(company_id));
CREATE POLICY company_industries_update_policy ON public.company_industries
  FOR UPDATE USING (user_can_admin_company(company_id));
CREATE POLICY company_industries_delete_policy ON public.company_industries
  FOR DELETE USING (user_can_admin_company(company_id));

-- ===== company_search_terms =====
DROP POLICY IF EXISTS company_search_terms_select_policy ON public.company_search_terms;
DROP POLICY IF EXISTS company_search_terms_update_policy ON public.company_search_terms;
DROP POLICY IF EXISTS company_search_terms_delete_policy ON public.company_search_terms;

CREATE POLICY company_search_terms_select_policy ON public.company_search_terms
  FOR SELECT USING (user_can_access_company(company_id));
CREATE POLICY company_search_terms_update_policy ON public.company_search_terms
  FOR UPDATE USING (user_can_admin_company(company_id));
CREATE POLICY company_search_terms_delete_policy ON public.company_search_terms
  FOR DELETE USING (user_can_admin_company(company_id));

-- ===== confirmed_prompts =====
DROP POLICY IF EXISTS confirmed_prompts_update_policy ON public.confirmed_prompts;
DROP POLICY IF EXISTS confirmed_prompts_delete_policy ON public.confirmed_prompts;

CREATE POLICY confirmed_prompts_update_policy ON public.confirmed_prompts
  FOR UPDATE USING (user_can_admin_company(company_id));
CREATE POLICY confirmed_prompts_delete_policy ON public.confirmed_prompts
  FOR DELETE USING (user_can_admin_company(company_id));

-- ===== prompt_responses =====
DROP POLICY IF EXISTS prompt_responses_update_policy ON public.prompt_responses;
DROP POLICY IF EXISTS prompt_responses_delete_policy ON public.prompt_responses;

CREATE POLICY prompt_responses_update_policy ON public.prompt_responses
  FOR UPDATE USING (user_can_admin_company(company_id));
CREATE POLICY prompt_responses_delete_policy ON public.prompt_responses
  FOR DELETE USING (user_can_admin_company(company_id));

-- ===== ai_themes =====
DROP POLICY IF EXISTS ai_themes_update_policy ON public.ai_themes;
DROP POLICY IF EXISTS ai_themes_delete_policy ON public.ai_themes;

CREATE POLICY ai_themes_update_policy ON public.ai_themes
  FOR UPDATE USING (
    response_id IN (SELECT id FROM prompt_responses pr WHERE user_can_admin_company(pr.company_id))
  );
CREATE POLICY ai_themes_delete_policy ON public.ai_themes
  FOR DELETE USING (
    response_id IN (SELECT id FROM prompt_responses pr WHERE user_can_admin_company(pr.company_id))
  );

-- ===== search_insights_results / terms =====
DROP POLICY IF EXISTS search_insights_results_select_policy ON public.search_insights_results;
CREATE POLICY search_insights_results_select_policy ON public.search_insights_results
  FOR SELECT USING (user_can_access_company(company_id));

DROP POLICY IF EXISTS search_insights_terms_select_policy ON public.search_insights_terms;
CREATE POLICY search_insights_terms_select_policy ON public.search_insights_terms
  FOR SELECT USING (user_can_access_company(company_id));
