-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260304132825; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE TABLE IF NOT EXISTS public.company_employee_tiers (
  company_name text PRIMARY KEY,
  estimated_tier text NOT NULL CHECK (estimated_tier IN ('unknown', '<50', '50-499', '500-4999', '5000-49999', '50000+')),
  confidence text DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  classified_by text DEFAULT 'llm',
  classified_at timestamptz DEFAULT now()
);

CREATE INDEX idx_company_employee_tiers_tier ON public.company_employee_tiers(estimated_tier);

COMMENT ON TABLE public.company_employee_tiers IS 'LLM-estimated employee count tiers for visibility index companies';
