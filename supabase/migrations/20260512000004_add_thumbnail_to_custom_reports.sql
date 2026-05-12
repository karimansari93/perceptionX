-- Store a preview thumbnail path (PNG of page 1) for each PDF custom report.
ALTER TABLE public.custom_reports
  ADD COLUMN IF NOT EXISTS thumbnail_path text;
