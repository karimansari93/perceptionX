-- Clients can dismiss an action and say why, so PerceptionX learns which
-- recommendations do not land. A dismissed action leaves the board and can be
-- restored. The reason is the client's own; tracking_status (our verdict) is
-- untouched.
--
-- 1. work_status gains 'dismissed'; who, when, why and a free-text note are
--    stored beside it.
-- 2. dismiss_company_action: any member may dismiss an unowned action; an
--    owned one only its owner, an org owner/admin or a platform admin.
-- 3. restore_company_action: back to open by whoever dismissed it, an org
--    owner/admin or a platform admin.

ALTER TABLE public.company_actions DROP CONSTRAINT company_actions_work_status_check;
ALTER TABLE public.company_actions ADD CONSTRAINT company_actions_work_status_check
  CHECK (work_status IN ('open', 'in_progress', 'done', 'dismissed'));

ALTER TABLE public.company_actions
  ADD COLUMN IF NOT EXISTS dismissed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dismiss_reason text
    CONSTRAINT company_actions_dismiss_reason_check CHECK (dismiss_reason IS NULL OR dismiss_reason IN (
      'already_done', 'not_our_market', 'not_our_area', 'disagree', 'not_now', 'other')),
  ADD COLUMN IF NOT EXISTS dismiss_note   text;

COMMENT ON COLUMN public.company_actions.dismiss_reason IS 'Why the client dismissed the action: already_done, not_our_market, not_our_area, disagree, not_now, other.';
COMMENT ON COLUMN public.company_actions.dismiss_note   IS 'The client''s own words on why they dismissed it.';

CREATE OR REPLACE FUNCTION public.dismiss_company_action(p_action_id uuid, p_reason text, p_note text DEFAULT NULL)
RETURNS public.company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action public.company_actions;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('already_done', 'not_our_market', 'not_our_area', 'disagree', 'not_now', 'other') THEN
    RAISE EXCEPTION 'Please choose a reason';
  END IF;

  SELECT * INTO v_action FROM company_actions WHERE id = p_action_id;
  IF NOT FOUND OR v_action.published_at IS NULL THEN
    RAISE EXCEPTION 'Action not found';
  END IF;
  IF NOT is_org_member(v_action.organization_id) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Action not found';
  END IF;
  IF v_action.assignee_id IS NOT NULL
     AND v_action.assignee_id IS DISTINCT FROM v_caller
     AND NOT is_admin()
     AND NOT is_org_super_admin(v_action.organization_id) THEN
    RAISE EXCEPTION 'Only the owner of this action can dismiss it';
  END IF;

  UPDATE company_actions
     SET work_status    = 'dismissed',
         dismissed_at   = now(),
         dismissed_by   = v_caller,
         dismiss_reason = p_reason,
         dismiss_note   = NULLIF(TRIM(COALESCE(p_note, '')), '')
   WHERE id = p_action_id
   RETURNING * INTO v_action;
  RETURN v_action;
END;
$$;
REVOKE ALL ON FUNCTION public.dismiss_company_action(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_company_action(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_company_action(p_action_id uuid)
RETURNS public.company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action public.company_actions;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_action FROM company_actions WHERE id = p_action_id;
  IF NOT FOUND OR v_action.published_at IS NULL THEN
    RAISE EXCEPTION 'Action not found';
  END IF;
  IF NOT is_org_member(v_action.organization_id) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Action not found';
  END IF;
  IF v_action.dismissed_by IS DISTINCT FROM v_caller
     AND NOT is_admin()
     AND NOT is_org_super_admin(v_action.organization_id) THEN
    RAISE EXCEPTION 'Only the person who dismissed this action can restore it';
  END IF;

  UPDATE company_actions
     SET work_status    = 'open',
         dismissed_at   = NULL,
         dismissed_by   = NULL,
         dismiss_reason = NULL,
         dismiss_note   = NULL
   WHERE id = p_action_id
   RETURNING * INTO v_action;
  RETURN v_action;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_company_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_company_action(uuid) TO authenticated;
