-- Publish a cycle of the action register for one organisation, so admins
-- stop publishing through load migrations. Sets published_at on that
-- cycle's actions and its report snapshot where still null; already
-- published rows keep their timestamp. Platform admins only.
--
-- Additive only (one new function).

CREATE OR REPLACE FUNCTION public.admin_publish_company_actions(p_organization_id uuid, p_cycle text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actions integer;
  v_snapshots integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only a PerceptionX admin can publish actions';
  END IF;

  UPDATE company_actions
     SET published_at = now()
   WHERE organization_id = p_organization_id
     AND cycle_raised = p_cycle
     AND published_at IS NULL;
  GET DIAGNOSTICS v_actions = ROW_COUNT;

  UPDATE client_report_snapshots
     SET published_at = now()
   WHERE organization_id = p_organization_id
     AND cycle = p_cycle
     AND published_at IS NULL;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  RETURN jsonb_build_object('actions_published', v_actions, 'snapshots_published', v_snapshots);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_publish_company_actions(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_company_actions(uuid, text) TO authenticated;
