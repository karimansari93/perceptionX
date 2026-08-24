-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260817070407; this file was
-- back-filled afterwards and therefore post-dates the deployment.

ALTER TABLE public.company_actions
  ADD COLUMN IF NOT EXISTS work_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS source_label TEXT,
  ADD COLUMN IF NOT EXISTS source_domain TEXT,
  ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS steps_done INT[] NOT NULL DEFAULT '{}';

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_actions_work_kind_check'
  ) THEN
    ALTER TABLE public.company_actions
      ADD CONSTRAINT company_actions_work_kind_check
      CHECK (work_kind IS NULL OR work_kind IN (
        'reviews', 'conversations', 'outreach', 'profile_claims',
        'certifications', 'owned_content', 'social_pr'
      ));
  END IF;
END $mig$;

COMMENT ON COLUMN public.company_actions.work_kind IS
  'What kind of work the action is, which determines who has to say yes. Orthogonal to register.';
COMMENT ON COLUMN public.company_actions.steps IS
  'Authored checklist (array of strings). Overwritten on re-import; completion lives in steps_done.';
COMMENT ON COLUMN public.company_actions.steps_done IS
  'Zero-based indices of ticked steps. Owner state — never written by an import.';

CREATE OR REPLACE FUNCTION public.set_company_action_steps(
  p_action_id UUID,
  p_done INT[]
)
RETURNS public.company_actions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_action public.company_actions;
  v_total INT;
  v_clean INT[];
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_action FROM company_actions WHERE id = p_action_id;
  IF NOT FOUND OR v_action.published_at IS NULL THEN
    RAISE EXCEPTION 'Action not found';
  END IF;

  IF NOT is_org_member(v_action.organization_id) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Action not found';
  END IF;

  IF v_action.assignee_id IS DISTINCT FROM auth.uid()
     AND NOT is_admin()
     AND NOT is_org_super_admin(v_action.organization_id) THEN
    RAISE EXCEPTION 'Only the owner of this action can tick its steps';
  END IF;

  v_total := jsonb_array_length(v_action.steps);

  SELECT COALESCE(array_agg(DISTINCT i ORDER BY i), '{}')
    INTO v_clean
    FROM unnest(COALESCE(p_done, '{}')) AS i
   WHERE i >= 0 AND i < v_total;

  v_status := CASE
    WHEN v_total > 0 AND array_length(v_clean, 1) = v_total THEN 'done'
    WHEN array_length(v_clean, 1) > 0 THEN 'in_progress'
    ELSE 'open'
  END;

  UPDATE company_actions
     SET steps_done       = v_clean,
         work_status      = v_status,
         asserted_done_at = CASE WHEN v_status = 'done'
                                 THEN COALESCE(asserted_done_at, NOW()) END,
         asserted_done_by = CASE WHEN v_status = 'done'
                                 THEN COALESCE(asserted_done_by, auth.uid()) END,
         assertion_note   = CASE WHEN v_status = 'done' THEN assertion_note END,
         assertion_url    = CASE WHEN v_status = 'done' THEN assertion_url END
   WHERE id = p_action_id
   RETURNING * INTO v_action;

  RETURN v_action;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.set_company_action_steps(UUID, INT[]) TO authenticated;
