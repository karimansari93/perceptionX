-- Client knowledge base: report snapshots + the action register, readable by
-- the in-app chat for the viewer's organization only.
--
-- 1. company_actions (exists since 2026-07-29) gains the fields a report
--    action carries and tracking_status: OUR verdict on the action, set from
--    the admin side and re-checked each cycle. It sits beside the client's
--    own work_status (open / in_progress / done), which stays an assertion
--    by the client's owner, as the register was designed. Watch items live in
--    the same register (register = 'watch').
-- 2. company_action_checks: one row per action per cycle. The baseline cycle
--    writes the starting readings; each later report adds its own row, so
--    movement cycle to cycle is a read, not a diff of overwritten fields.
-- 3. client_report_snapshots: one row per organization per cycle per report
--    type, with headline metrics, breakdowns and per-metric status
--    (provisional / final) the chat must quote.
--
-- Tenancy: every row carries organization_id. Clients read published rows of
-- their own organization through RLS; nothing is client-writable except
-- through the existing SECURITY DEFINER RPCs. The chat reads with the
-- service role and filters on the caller's verified organization in code.
-- Stored text: percentages only, no raw counts, no em dashes, no other
-- PerceptionX clients.
--
-- Additive only (no constraint or object is removed), so it runs through the
-- Supabase MCP from a cloud session.

-- ─── 1. company_actions ─────────────────────────────────────────────────────

ALTER TABLE public.company_actions
  ADD COLUMN IF NOT EXISTS cycle_raised    text,
  ADD COLUMN IF NOT EXISTS action_number   integer,
  ADD COLUMN IF NOT EXISTS problem         text,
  ADD COLUMN IF NOT EXISTS ai_says         text,
  ADD COLUMN IF NOT EXISTS urls            text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lanes           text[]  NOT NULL DEFAULT '{}'
    CONSTRAINT company_actions_lanes_check CHECK (lanes <@ ARRAY['business', 'owned', 'people']::text[]),
  ADD COLUMN IF NOT EXISTS timing          text
    CONSTRAINT company_actions_timing_check CHECK (timing IS NULL OR timing IN ('act_now', 'act_next', 'act_later')),
  ADD COLUMN IF NOT EXISTS lifts           jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proof_status    text,
  ADD COLUMN IF NOT EXISTS verified_facts  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_name      text,
  ADD COLUMN IF NOT EXISTS tracking_status text    NOT NULL DEFAULT 'open'
    CONSTRAINT company_actions_tracking_status_check
    CHECK (tracking_status IN ('open', 'in_progress', 'done', 'stalled', 'escalated', 'retired')),
  ADD COLUMN IF NOT EXISTS notes           text;

COMMENT ON COLUMN public.company_actions.cycle_raised    IS 'Collection cycle the action was first raised in, e.g. 2026-09-01. Stays fixed as the action is carried.';
COMMENT ON COLUMN public.company_actions.action_number   IS 'Number shown in the report (01, 02 ...), unique per organization and cycle_raised.';
COMMENT ON COLUMN public.company_actions.ai_reads        IS 'Where AI reads it: [{source, market, coverage_pct, url}]. coverage_pct = share of the relevant answers citing the source.';
COMMENT ON COLUMN public.company_actions.recommendation  IS 'What to do.';
COMMENT ON COLUMN public.company_actions.lifts           IS 'Metrics the action should move: [{metric, attribute, market}].';
COMMENT ON COLUMN public.company_actions.verified_facts  IS 'Facts checked on the live web: [{fact, checked_on (YYYY-MM-DD)}].';
COMMENT ON COLUMN public.company_actions.owner_name      IS 'Client owner as agreed in conversation (free text). assignee_id is the in-app owner.';
COMMENT ON COLUMN public.company_actions.tracking_status IS 'PerceptionX verdict, admin-set: open, in_progress, done, stalled, escalated, retired. work_status is the client owner''s own assertion.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_actions_number
  ON public.company_actions (organization_id, cycle_raised, action_number)
  WHERE action_number IS NOT NULL;

-- Admin side: tracking status, client owner and notes. Clients keep using
-- set_company_action_status / assign_company_action for their own fields.
CREATE OR REPLACE FUNCTION public.admin_update_company_action(
  p_action_id uuid, p_tracking_status text DEFAULT NULL, p_owner_name text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS public.company_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action public.company_actions;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only a PerceptionX admin can update this action';
  END IF;
  UPDATE company_actions
     SET tracking_status = COALESCE(p_tracking_status, tracking_status),
         register        = CASE WHEN p_tracking_status = 'retired' THEN 'retired' ELSE register END,
         owner_name      = COALESCE(NULLIF(TRIM(p_owner_name), ''), owner_name),
         notes           = COALESCE(NULLIF(TRIM(p_notes), ''), notes)
   WHERE id = p_action_id
   RETURNING * INTO v_action;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found'; END IF;
  RETURN v_action;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_company_action(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_company_action(uuid, text, text, text) TO authenticated;

-- ─── 2. company_action_checks ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_action_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id       uuid NOT NULL REFERENCES public.company_actions(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  cycle           text NOT NULL,
  checked_on      date NOT NULL,
  status          text NOT NULL
    CHECK (status IN ('open', 'in_progress', 'done', 'stalled', 'escalated', 'retired')),
  metric_readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_facts  jsonb NOT NULL DEFAULT '[]'::jsonb,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, cycle)
);
COMMENT ON TABLE  public.company_action_checks IS 'One row per action per collection cycle: our status and the metric readings at that check. The first row is the baseline.';
COMMENT ON COLUMN public.company_action_checks.metric_readings IS '[{metric, attribute, market, value_pct, metric_status}] as measured in this cycle.';

CREATE INDEX IF NOT EXISTS idx_company_action_checks_org ON public.company_action_checks (organization_id, cycle);

-- organization_id always follows the parent action, whatever the writer sent.
CREATE OR REPLACE FUNCTION public.company_action_checks_set_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM company_actions WHERE id = NEW.action_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER company_action_checks_set_org
  BEFORE INSERT OR UPDATE ON public.company_action_checks
  FOR EACH ROW EXECUTE FUNCTION public.company_action_checks_set_org();

ALTER TABLE public.company_action_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_action_checks_select ON public.company_action_checks
  FOR SELECT TO authenticated
  USING (is_admin() OR (is_org_member(organization_id) AND EXISTS (
    SELECT 1 FROM public.company_actions a
     WHERE a.id = company_action_checks.action_id AND a.published_at IS NOT NULL)));
REVOKE ALL ON public.company_action_checks FROM anon, authenticated;
GRANT SELECT ON public.company_action_checks TO authenticated;

-- ─── 3. client_report_snapshots ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_report_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id),
  company_id         uuid REFERENCES public.companies(id),
  cycle              text NOT NULL,
  period_label       text NOT NULL,
  report_type        text NOT NULL
    CHECK (report_type IN ('baseline', 'quarterly', 'refresh', 'pilot', 'custom')),
  scope              jsonb NOT NULL DEFAULT '{}'::jsonb,
  headline           jsonb NOT NULL DEFAULT '{}'::jsonb,
  metric_status      jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdowns         jsonb NOT NULL DEFAULT '{}'::jsonb,
  as_of              date NOT NULL,
  source_report_name text NOT NULL,
  signed_off_by      text,
  signed_off_on      date,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cycle, report_type)
);
COMMENT ON TABLE  public.client_report_snapshots IS 'What a client report said, per organization per cycle. Percentages only. Draft until published_at is set.';
COMMENT ON COLUMN public.client_report_snapshots.scope         IS '{markets:[{market, functions}], excluded, assistants, assistant_notes, brand_aliases, collection}';
COMMENT ON COLUMN public.client_report_snapshots.headline      IS '{overall_score, sentiment_pct, visibility_pct, relevance}';
COMMENT ON COLUMN public.client_report_snapshots.metric_status IS '{<metric>: {status: provisional|final, since, reason}}. The chat says "provisional" for any metric not final.';
COMMENT ON COLUMN public.client_report_snapshots.breakdowns    IS '{visibility_by_market, attribute_sentiment, sources}: label + percentage rows.';

CREATE INDEX IF NOT EXISTS idx_client_report_snapshots_org ON public.client_report_snapshots (organization_id, published_at);

CREATE OR REPLACE TRIGGER update_client_report_snapshots_updated_at
  BEFORE UPDATE ON public.client_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.client_report_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_report_snapshots_select ON public.client_report_snapshots
  FOR SELECT TO authenticated
  USING (is_admin() OR (published_at IS NOT NULL AND is_org_member(organization_id)));
REVOKE ALL ON public.client_report_snapshots FROM anon, authenticated;
GRANT SELECT ON public.client_report_snapshots TO authenticated;
