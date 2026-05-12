-- Per-organization region list. Freeform, defined per client.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS regions text[] NOT NULL DEFAULT '{}';

-- Drop the global CHECK so any org-defined region label is accepted.
ALTER TABLE public.custom_reports
  DROP CONSTRAINT IF EXISTS custom_reports_region_check;
