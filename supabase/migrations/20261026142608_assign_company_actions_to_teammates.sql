-- Members can hand actions to teammates, not only claim them.
--
-- assign_company_action, new rule:
--   - any member may assign an unowned action to any member of the
--     organisation (themselves included);
--   - the current owner may hand it to another member or unassign it;
--   - org owners/admins and platform admins may change any action.
--   A member cannot take over an action someone else owns.
--
-- The owner picker lists teammates through list_action_assignees, which is
-- already live (user_id, full_name, email; members of the organisation and
-- platform admins only). It is not redefined here.

CREATE OR REPLACE FUNCTION public.assign_company_action(p_action_id uuid, p_assignee_id uuid)
RETURNS company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_action public.company_actions;
  v_is_super BOOLEAN;
  v_caller UUID := auth.uid();
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

  UPDATE company_actions
     SET assignee_id = p_assignee_id,
         assigned_by = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE v_caller END,
         assigned_at = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE NOW() END
   WHERE id = p_action_id
   RETURNING * INTO v_action;

  RETURN v_action;
END;
$function$;
