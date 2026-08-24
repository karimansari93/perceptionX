-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260303093947; this file was
-- back-filled afterwards and therefore post-dates the deployment.


create table company_snapshots (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  industry text not null,
  country text not null,
  snapshot_text text not null,
  generated_at timestamptz not null default now(),
  model_version text not null default 'claude-sonnet-4-20250514'
);

create unique index company_snapshots_unique
  on company_snapshots (canonical_name, industry, country);

alter table company_snapshots enable row level security;

create policy "Public read access"
  on company_snapshots for select
  using (true);

