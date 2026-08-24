-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260303101046; this file was
-- back-filled afterwards and therefore post-dates the deployment.


create table company_branding (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  banner_url text,
  brand_color text,
  domain text,
  fetched_at timestamptz not null default now()
);

alter table company_branding enable row level security;

create policy "Public read access"
  on company_branding for select
  using (true);

