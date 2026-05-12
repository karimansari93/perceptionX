-- Add quarter / year / region columns to custom_reports so PDFs can be
-- filed and filtered by reporting period and geography.

ALTER TABLE public.custom_reports
  ADD COLUMN IF NOT EXISTS period_year    int,
  ADD COLUMN IF NOT EXISTS period_quarter int,
  ADD COLUMN IF NOT EXISTS region         text;

ALTER TABLE public.custom_reports
  DROP CONSTRAINT IF EXISTS custom_reports_quarter_check;
ALTER TABLE public.custom_reports
  ADD CONSTRAINT custom_reports_quarter_check
  CHECK (period_quarter IS NULL OR period_quarter BETWEEN 1 AND 4);

ALTER TABLE public.custom_reports
  DROP CONSTRAINT IF EXISTS custom_reports_region_check;
ALTER TABLE public.custom_reports
  ADD CONSTRAINT custom_reports_region_check
  CHECK (region IS NULL OR region IN ('GLOBAL','APAC','EMEA','UCAN','LATAM'));

CREATE INDEX IF NOT EXISTS custom_reports_org_period_idx
  ON public.custom_reports (organization_id, period_year DESC, period_quarter DESC, region);
