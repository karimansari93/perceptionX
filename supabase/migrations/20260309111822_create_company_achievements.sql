-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260309111822; this file was
-- back-filled afterwards and therefore post-dates the deployment.


create table company_achievements (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  achievement_key text not null,
  achievement_label text not null,
  achievement_emoji text not null,
  achievement_category text not null check (achievement_category in ('visibility', 'reach', 'consistency', 'attribute')),
  attribute_name text,
  industry_context text,
  country text,
  earned_at timestamptz not null default now(),
  period text not null,
  metadata jsonb,
  unique(canonical_name, achievement_key, industry_context, country, period)
);

alter table company_achievements enable row level security;

create policy "Public read access"
  on company_achievements for select
  using (true);

-- Index for fast lookups by company
create index idx_company_achievements_canonical_name 
  on company_achievements(canonical_name);

-- Index for period-based queries
create index idx_company_achievements_period 
  on company_achievements(period);

-- Index for attribute champion lookups
create index idx_company_achievements_key 
  on company_achievements(achievement_key);

