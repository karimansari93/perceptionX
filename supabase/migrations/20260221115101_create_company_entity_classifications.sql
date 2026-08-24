-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260221115101; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE TABLE public.company_entity_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL UNIQUE,  -- normalized lowercase, matches rankings_overview.company_name
  entity_type text NOT NULL CHECK (entity_type IN ('company', 'source', 'ambiguous')),
  reason text,                         -- human-readable explanation
  industry_count int,                  -- snapshot at time of classification
  total_mentions int,
  classified_by text DEFAULT 'system', -- 'system', 'manual', 'ai'
  reviewed boolean DEFAULT false,      -- manually confirmed
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_entity_classifications_name ON public.company_entity_classifications(company_name);
CREATE INDEX idx_entity_classifications_type ON public.company_entity_classifications(entity_type);

-- RLS
ALTER TABLE public.company_entity_classifications ENABLE ROW LEVEL SECURITY;

-- Public read (needed by rankings queries)
CREATE POLICY "Public read entity classifications"
  ON public.company_entity_classifications FOR SELECT
  USING (true);

-- Only service role can write
CREATE POLICY "Service role write entity classifications"
  ON public.company_entity_classifications FOR ALL
  USING (auth.role() = 'service_role');

