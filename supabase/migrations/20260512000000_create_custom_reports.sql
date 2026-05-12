-- Custom Reports: admin-uploaded PDF/PPTX files surfaced to org members
-- in the dashboard at /analyze/reports.

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  file_path       text NOT NULL,
  file_size       bigint,
  mime_type       text,
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_reports_org_created_idx
  ON public.custom_reports (organization_id, created_at DESC);

ALTER TABLE public.custom_reports ENABLE ROW LEVEL SECURITY;

-- Members of the org can read its custom reports. Admins bypass via is_admin().
CREATE POLICY custom_reports_select
  ON public.custom_reports
  FOR SELECT
  USING (
    (SELECT is_admin())
    OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = custom_reports.organization_id
        AND om.user_id = (SELECT auth.uid())
    )
  );

-- Only admins can write.
CREATE POLICY custom_reports_admin_insert
  ON public.custom_reports
  FOR INSERT
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY custom_reports_admin_update
  ON public.custom_reports
  FOR UPDATE
  USING ((SELECT is_admin()))
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY custom_reports_admin_delete
  ON public.custom_reports
  FOR DELETE
  USING ((SELECT is_admin()));

-- ─── Storage bucket ───────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('custom-reports', 'custom-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Members of the org (derived from first path segment = org id) can read files.
CREATE POLICY "custom-reports read by org members"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'custom-reports'
    AND (
      (SELECT is_admin())
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = ((storage.foldername(name))[1])::uuid
          AND om.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "custom-reports admin write"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'custom-reports' AND (SELECT is_admin())
  );

CREATE POLICY "custom-reports admin update"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'custom-reports' AND (SELECT is_admin()))
  WITH CHECK (bucket_id = 'custom-reports' AND (SELECT is_admin()));

CREATE POLICY "custom-reports admin delete"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'custom-reports' AND (SELECT is_admin()));
