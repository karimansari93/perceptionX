-- Activity on an action: clients leave comments, and every change made
-- through the action RPCs (assign, status, dismiss, restore) is logged as an
-- event. The Actions panel shows both as one feed, so PerceptionX can see
-- what a client is doing with each recommendation and the client can keep
-- notes beside it.
--
-- 1. company_action_activity: one row per comment or event. Members of the
--    organisation read the feed of any published action and may add
--    comments (kind = 'comment', in their own name). Platform admins read and
--    comment on every organisation's actions. Events are written only by
--    the SECURITY DEFINER RPCs below; nobody can edit or delete rows.
-- 2. assign_company_action, set_company_action_status,
--    dismiss_company_action and restore_company_action each log what they
--    changed. Their rules are unchanged.

CREATE TABLE IF NOT EXISTS public.company_action_activity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id       uuid NOT NULL REFERENCES public.company_actions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind            text NOT NULL
    CHECK (kind IN ('comment', 'assigned', 'status', 'dismissed', 'restored')),
  body            text,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_action_activity_comment_body_check
    CHECK (kind <> 'comment' OR length(trim(coalesce(body, ''))) BETWEEN 1 AND 2000)
);
COMMENT ON TABLE  public.company_action_activity IS 'Comments and change events on a company action, shown as one feed in the Actions panel.';
COMMENT ON COLUMN public.company_action_activity.kind IS 'comment (a member''s note) or an event written by the action RPCs: assigned, status, dismissed, restored.';
COMMENT ON COLUMN public.company_action_activity.data IS 'Event details: assigned {from, to}; status {from, to, note, url}; dismissed {reason, note}.';

CREATE INDEX IF NOT EXISTS idx_company_action_activity_action
  ON public.company_action_activity (action_id, created_at);

-- organization_id always follows the parent action, whatever the writer sent.
CREATE OR REPLACE FUNCTION public.company_action_activity_set_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM company_actions WHERE id = NEW.action_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'Action not found';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER company_action_activity_set_org
  BEFORE INSERT OR UPDATE ON public.company_action_activity
  FOR EACH ROW EXECUTE FUNCTION public.company_action_activity_set_org();

ALTER TABLE public.company_action_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_action_activity_select ON public.company_action_activity
  FOR SELECT TO authenticated
  USING (is_admin() OR (is_org_member(organization_id) AND EXISTS (
    SELECT 1 FROM public.company_actions a
     WHERE a.id = company_action_activity.action_id AND a.published_at IS NOT NULL)));

-- Comments only, in the writer's own name, on a published action they can see.
CREATE POLICY company_action_activity_insert_comment ON public.company_action_activity
  FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'comment'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.company_actions a
       WHERE a.id = company_action_activity.action_id
         AND a.published_at IS NOT NULL
         AND (is_admin() OR is_org_member(a.organization_id))));

REVOKE ALL ON public.company_action_activity FROM anon, authenticated;
GRANT SELECT, INSERT ON public.company_action_activity TO authenticated;

-- ─── Event logging in the action RPCs ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_company_action(p_action_id uuid, p_assignee_id uuid)
RETURNS company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_action public.company_actions;
  v_is_super BOOLEAN;
  v_caller UUID := auth.uid();
  v_from UUID;
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

  v_is_super := is_admin() OR is_org_super_admin(v_action.organization_id);

  IF NOT v_is_super
     AND v_action.assignee_id IS NOT NULL
     AND v_action.assignee_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Only the owner of this action or an admin can reassign it';
  END IF;

  IF p_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = v_action.organization_id
      AND user_id = p_assignee_id
  ) THEN
    RAISE EXCEPTION 'Assignee is not a member of this organization';
  END IF;

  v_from := v_action.assignee_id;

  UPDATE company_actions
     SET assignee_id = p_assignee_id,
         assigned_by = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE v_caller END,
         assigned_at = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE NOW() END
   WHERE id = p_action_id
   RETURNING * INTO v_action;

  IF v_from IS DISTINCT FROM p_assignee_id THEN
    INSERT INTO company_action_activity (action_id, organization_id, actor_id, kind, data)
    VALUES (p_action_id, v_action.organization_id, v_caller, 'assigned',
            jsonb_build_object('from', v_from, 'to', p_assignee_id));
  END IF;

  RETURN v_action;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_company_action_status(p_action_id uuid, p_status text, p_note text DEFAULT NULL::text, p_url text DEFAULT NULL::text)
RETURNS company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_action public.company_actions;
  v_caller UUID := auth.uid();
  v_from TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_status NOT IN ('open', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  SELECT * INTO v_action FROM company_actions WHERE id = p_action_id;
  IF NOT FOUND OR v_action.published_at IS NULL THEN
    RAISE EXCEPTION 'Action not found';
  END IF;

  IF NOT is_org_member(v_action.organization_id) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Action not found';
  END IF;

  IF v_action.assignee_id IS DISTINCT FROM v_caller
     AND NOT is_admin()
     AND NOT is_org_super_admin(v_action.organization_id) THEN
    RAISE EXCEPTION 'Only the owner of this action can change its status';
  END IF;

  v_from := v_action.work_status;

  UPDATE company_actions
     SET work_status      = p_status,
         asserted_done_at = CASE WHEN p_status = 'done' THEN NOW() END,
         asserted_done_by = CASE WHEN p_status = 'done' THEN v_caller END,
         assertion_note   = CASE WHEN p_status = 'done' THEN NULLIF(TRIM(COALESCE(p_note, '')), '') END,
         assertion_url    = CASE WHEN p_status = 'done' THEN NULLIF(TRIM(COALESCE(p_url, '')), '') END
   WHERE id = p_action_id
   RETURNING * INTO v_action;

  IF v_from IS DISTINCT FROM p_status THEN
    INSERT INTO company_action_activity (action_id, organization_id, actor_id, kind, data)
    VALUES (p_action_id, v_action.organization_id, v_caller, 'status',
            jsonb_strip_nulls(jsonb_build_object(
              'from', v_from, 'to', p_status,
              'note', CASE WHEN p_status = 'done' THEN v_action.assertion_note END,
              'url',  CASE WHEN p_status = 'done' THEN v_action.assertion_url END)));
  END IF;

  RETURN v_action;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_company_action(p_action_id uuid, p_reason text, p_note text DEFAULT NULL::text)
RETURNS company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  INSERT INTO company_action_activity (action_id, organization_id, actor_id, kind, data)
  VALUES (p_action_id, v_action.organization_id, v_caller, 'dismissed',
          jsonb_strip_nulls(jsonb_build_object('reason', p_reason, 'note', v_action.dismiss_note)));

  RETURN v_action;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_company_action(p_action_id uuid)
RETURNS company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  INSERT INTO company_action_activity (action_id, organization_id, actor_id, kind)
  VALUES (p_action_id, v_action.organization_id, v_caller, 'restored');

  RETURN v_action;
END;
$function$;
