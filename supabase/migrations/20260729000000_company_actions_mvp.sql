-- Actions MVP
-- ---------------------------------------------------------------------------
-- The recommendations we ship in the quarterly PDF, as rows a named owner can
-- pick up in the dashboard. One table on purpose: the per-edition history
-- tables (report_editions / action_editions) only earn their place once there
-- is a second edition to compare against. Until then `period_label` and the
-- hand-set `overdue_count` carry what the Q3 report already asserts, and the
-- backfill to a proper edition model is one row per action.
--
-- Two status axes, deliberately not collapsed:
--   * editorial_status / register / overdue_count  -- ours, set when we author
--     the report from the data.
--   * work_status + assertion_*                    -- the owner's. `done` is an
--     ASSERTION that the work happened, not a verified resolution. Whether the
--     problem is actually gone is a data question answered by the next report,
--     so nothing here is terminal and nothing is ever deleted.
--
-- All client writes go through the two SECURITY DEFINER RPCs at the bottom.
-- The table itself is SELECT-only for authenticated users (same shape as
-- organization_invites), because RLS can gate rows but not columns: a plain
-- UPDATE policy permissive enough to let a member self-assign would also let
-- them rewrite the title and evidence.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper: is the caller a member (any role) of this org?
--    SECURITY DEFINER so it can read organization_members without tripping
--    that table's own policies (members can only see their own row there).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Actions are ORG-scoped. A client org holds one company profile per market
  -- (Netflix has 19: US, DE, JP, KR, ... plus Animation Studios and Eyeline)
  -- and a quarterly report spans all of them, so scoping to one company would
  -- hide the Germany action from anyone viewing the US profile. The applicable
  -- market lives in markets[].
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Optional pin, for the rare action that concerns one profile only.
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Stable authored slug, e.g. 'kununu-germany-claim'. Re-running an edition
  -- upserts on (organization_id, key) rather than duplicating the action, so the
  -- ownership and assertion columns survive a re-import.
  key TEXT NOT NULL,
  period_label TEXT NOT NULL,

  -- --- Editorial: ours, authored with the report -----------------------------
  register TEXT NOT NULL DEFAULT 'act_now'
    CHECK (register IN ('act_now', 'watch', 'regional', 'retired')),
  editorial_status TEXT NOT NULL DEFAULT 'new'
    CHECK (editorial_status IN ('new', 'carried', 'overdue', 'retired')),
  -- The "OVERDUE x3" on the card. Hand-set for the MVP; derived from
  -- action_editions once that table exists.
  overdue_count INT NOT NULL DEFAULT 0,

  title TEXT NOT NULL,
  recommendation TEXT,
  evidence TEXT,

  -- Free-form authored vocabularies, intentionally unconstrained: the report
  -- already uses combinations ("Experience & Discovery") and one-offs
  -- ("Sentiment protection") that a CHECK would force us to migrate for.
  categories TEXT[] NOT NULL DEFAULT '{}',
  moves TEXT[] NOT NULL DEFAULT '{}',
  markets TEXT[] NOT NULL DEFAULT '{}',
  functions TEXT[] NOT NULL DEFAULT '{}',

  -- [{ "label": "kununu/netflix-services-germany", "url": "https://..." }]
  ai_reads JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Dashboard deep link that proves the claim, e.g.
  -- { "location_context": "Germany", "theme": "Wellbeing" }
  evidence_filter JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- --- Ownership -------------------------------------------------------------
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,

  -- --- Owner-side lifecycle --------------------------------------------------
  work_status TEXT NOT NULL DEFAULT 'open'
    CHECK (work_status IN ('open', 'in_progress', 'done')),
  asserted_done_at TIMESTAMPTZ,
  asserted_done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- What they did, and a link to it. Optional, but this is report-grade input:
  -- at authoring time we can check the claim against the citation data.
  assertion_note TEXT,
  assertion_url TEXT,

  -- --- Publish gate ----------------------------------------------------------
  -- NULL = draft: invisible to clients and never emailed, so a whole quarter
  -- can be authored in place without leaking half-written actions.
  published_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_actions_key
  ON public.company_actions(organization_id, key);
CREATE INDEX IF NOT EXISTS idx_company_actions_org_published
  ON public.company_actions(organization_id, published_at);
CREATE INDEX IF NOT EXISTS idx_company_actions_assignee
  ON public.company_actions(assignee_id) WHERE assignee_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_company_actions_updated_at ON public.company_actions;
CREATE TRIGGER update_company_actions_updated_at
  BEFORE UPDATE ON public.company_actions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. RLS: everyone in the org reads every published action.
--    Assignment is a filter in the UI, not a visibility boundary.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. assign_company_action
--    Super admins assign anyone. Any member can take an UNASSIGNED action for
--    themselves — the "no owner yet, grab it" case — but cannot reassign one
--    that already has an owner, or hand work to someone else.
-- ---------------------------------------------------------------------------
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

  -- Never assign work to someone outside the organization.
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

-- ---------------------------------------------------------------------------
-- 5. set_company_action_status
--    The owner (or a super admin) moves their own work along. 'done' records
--    an assertion with a timestamp and attribution — it does not resolve the
--    action, and it does not remove it from the register.
-- ---------------------------------------------------------------------------
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
         -- Reverting out of 'done' withdraws the assertion rather than
         -- keeping a stale "they said it was handled" on the record.
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

-- ---------------------------------------------------------------------------
-- 6. Assignable people, for the admin's assign dropdown.
--    organization_members is only readable by super admins, and the card needs
--    to show an owner's name to everyone, so both cases come through here.
-- ---------------------------------------------------------------------------
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

COMMIT;
