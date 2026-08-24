-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260729095157; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Actions MVP. See supabase/migrations/20260729000000_company_actions_mvp.sql
-- for the full rationale. Two status axes, deliberately not collapsed:
-- editorial (ours, authored with the report) and work status (the owner's,
-- where 'done' is an assertion rather than a verified resolution).

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.company_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  key TEXT NOT NULL,
  period_label TEXT NOT NULL,

  register TEXT NOT NULL DEFAULT 'act_now'
    CHECK (register IN ('act_now', 'watch', 'regional', 'retired')),
  editorial_status TEXT NOT NULL DEFAULT 'new'
    CHECK (editorial_status IN ('new', 'carried', 'overdue', 'retired')),
  overdue_count INT NOT NULL DEFAULT 0,

  title TEXT NOT NULL,
  recommendation TEXT,
  evidence TEXT,

  categories TEXT[] NOT NULL DEFAULT '{}',
  moves TEXT[] NOT NULL DEFAULT '{}',
  markets TEXT[] NOT NULL DEFAULT '{}',
  functions TEXT[] NOT NULL DEFAULT '{}',

  ai_reads JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_filter JSONB NOT NULL DEFAULT '{}'::jsonb,

  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,

  work_status TEXT NOT NULL DEFAULT 'open'
    CHECK (work_status IN ('open', 'in_progress', 'done')),
  asserted_done_at TIMESTAMPTZ,
  asserted_done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assertion_note TEXT,
  assertion_url TEXT,

  published_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_actions_key
  ON public.company_actions(company_id, key);
CREATE INDEX IF NOT EXISTS idx_company_actions_company_published
  ON public.company_actions(company_id, published_at);
CREATE INDEX IF NOT EXISTS idx_company_actions_org
  ON public.company_actions(organization_id);
CREATE INDEX IF NOT EXISTS idx_company_actions_assignee
  ON public.company_actions(assignee_id) WHERE assignee_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_company_actions_updated_at ON public.company_actions;
CREATE TRIGGER update_company_actions_updated_at
  BEFORE UPDATE ON public.company_actions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.company_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_actions_select_policy ON public.company_actions;
CREATE POLICY company_actions_select_policy ON public.company_actions
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR (published_at IS NOT NULL AND is_org_member(organization_id))
  );

COMMENT ON TABLE public.company_actions IS
  'Quarterly report recommendations as ownable work items. Client writes go through assign_company_action() and set_company_action_status(); the table is SELECT-only for authenticated users.';

CREATE OR REPLACE FUNCTION public.assign_company_action(
  p_action_id UUID,
  p_assignee_id UUID
)
RETURNS public.company_actions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT v_is_super THEN
    IF p_assignee_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'Only an admin can assign an action to someone else';
    END IF;
    IF v_action.assignee_id IS NOT NULL THEN
      RAISE EXCEPTION 'This action already has an owner';
    END IF;
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
$$;

GRANT EXECUTE ON FUNCTION public.assign_company_action(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_company_action_status(
  p_action_id UUID,
  p_status TEXT,
  p_note TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL
)
RETURNS public.company_actions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action public.company_actions;
  v_caller UUID := auth.uid();
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

  UPDATE company_actions
     SET work_status      = p_status,
         asserted_done_at = CASE WHEN p_status = 'done' THEN NOW() END,
         asserted_done_by = CASE WHEN p_status = 'done' THEN v_caller END,
         assertion_note   = CASE WHEN p_status = 'done' THEN NULLIF(TRIM(COALESCE(p_note, '')), '') END,
         assertion_url    = CASE WHEN p_status = 'done' THEN NULLIF(TRIM(COALESCE(p_url, '')), '') END
   WHERE id = p_action_id
   RETURNING * INTO v_action;

  RETURN v_action;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_company_action_status(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_action_assignees(p_organization_id UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.user_id, p.full_name, p.email
  FROM organization_members om
  LEFT JOIN profiles p ON p.id = om.user_id
  WHERE om.organization_id = p_organization_id
    AND (is_admin() OR is_org_member(p_organization_id))
  ORDER BY COALESCE(p.full_name, p.email);
$$;

GRANT EXECUTE ON FUNCTION public.list_action_assignees(UUID) TO authenticated;
