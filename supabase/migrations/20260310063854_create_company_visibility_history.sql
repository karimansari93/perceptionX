-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310063854; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE TABLE company_visibility_history (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  industry_context text not null,
  country text not null,
  index_period text not null,
  mention_count int not null default 0,
  visibility_score numeric(6,2),
  rank_position int,
  total_in_industry int,
  percentile numeric(5,2),
  recorded_at timestamptz not null default now(),
  unique(canonical_name, industry_context, country, index_period)
);

alter table company_visibility_history enable row level security;

create policy "Public read access"
  on company_visibility_history for select
  using (true);

create index idx_visibility_history_canonical_name
  on company_visibility_history(canonical_name);

create index idx_visibility_history_period
  on company_visibility_history(index_period);

create index idx_visibility_history_company_period
  on company_visibility_history(canonical_name, industry_context, country, index_period);

