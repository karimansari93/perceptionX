-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260327134052; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE TABLE IF NOT EXISTS company_brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  website_domain text,
  banner_url text,
  banner_source text, -- 'og_image', 'twitter_image', 'youtube', 'manual'
  logo_url text,
  logo_source text,
  brand_color text,
  fetched_at timestamptz,
  fetch_status text DEFAULT 'pending', -- 'pending', 'success', 'failed'
  fetch_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

