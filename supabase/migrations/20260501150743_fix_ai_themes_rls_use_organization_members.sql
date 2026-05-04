-- Migrate ai_themes SELECT policy off the dead company_members table.
-- Other RLS policies (companies, prompt_responses, confirmed_prompts) had
-- already been moved to organization_members; ai_themes was missed in
-- that pass, which caused the Themes panel to render empty for any user
-- whose access came via organization_members only.

DROP POLICY IF EXISTS ai_themes_select_policy ON public.ai_themes;

CREATE POLICY ai_themes_select_policy ON public.ai_themes
  FOR SELECT
  USING (
    (SELECT is_admin())
    OR response_id IN (
      SELECT pr.id FROM public.prompt_responses pr
      WHERE pr.for_index = true
         OR pr.company_id IN (
           SELECT oc.company_id
           FROM public.organization_companies oc
           JOIN public.organization_members om
             ON om.organization_id = oc.organization_id
           WHERE om.user_id = (SELECT auth.uid())
         )
    )
  );
