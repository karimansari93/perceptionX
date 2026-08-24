-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260413081925; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Drop old table and recreate with full SEO schema
DROP TABLE IF EXISTS public.company_snapshots CASCADE;

CREATE TABLE public.company_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  snapshot_text TEXT NOT NULL,
  snapshot_themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  h1_title TEXT NOT NULL,
  industry TEXT NOT NULL,
  country TEXT NOT NULL,
  visibility_score NUMERIC NOT NULL,
  rank_position INTEGER NOT NULL,
  total_companies INTEGER NOT NULL,
  percentile NUMERIC NOT NULL,
  top_competitors TEXT[] NOT NULL DEFAULT '{}',
  top_themes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_company_snapshots_slug ON public.company_snapshots (slug);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.company_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.company_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.company_snapshots
  FOR SELECT USING (true);

CREATE POLICY "Admin write access" ON public.company_snapshots
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
