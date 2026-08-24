-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260313091437; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Create the company_overrides table for managing company exclusions
-- and industry restrictions from the database instead of hardcoded logic.
create table public.company_overrides (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  status text not null default 'active' check (status in ('active', 'excluded', 'needs_review')),
  exclusion_reason text check (exclusion_reason in ('product_not_company', 'wrong_category', 'duplicate', 'not_a_company', 'other')),
  allowed_industries text[],
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for case-insensitive lookups
create index idx_company_overrides_canonical_lower on public.company_overrides (lower(canonical_name));

-- Auto-update updated_at on row change
create or replace function public.update_company_overrides_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_company_overrides_updated_at
  before update on public.company_overrides
  for each row
  execute function public.update_company_overrides_updated_at();

-- RLS: authenticated users can read, only service role can write
alter table public.company_overrides enable row level security;

create policy "Authenticated users can read company_overrides"
  on public.company_overrides for select
  to authenticated
  using (true);

create policy "Service role can insert company_overrides"
  on public.company_overrides for insert
  to service_role
  with check (true);

create policy "Service role can update company_overrides"
  on public.company_overrides for update
  to service_role
  using (true)
  with check (true);

create policy "Service role can delete company_overrides"
  on public.company_overrides for delete
  to service_role
  using (true);

-- Seed: Complete exclusions (status = 'excluded')
insert into public.company_overrides (canonical_name, status, exclusion_reason) values
  ('BigQuery',    'excluded', 'product_not_company'),
  ('iPhone',      'excluded', 'product_not_company'),
  ('Jira',        'excluded', 'product_not_company'),
  ('PowerPoint',  'excluded', 'product_not_company'),
  ('SharePoint',  'excluded', 'product_not_company'),
  ('Siri',        'excluded', 'product_not_company'),
  ('Teams',       'excluded', 'product_not_company'),
  ('Watson',      'excluded', 'product_not_company'),
  ('AWS AI',      'excluded', 'product_not_company'),
  ('Alexa',       'excluded', 'product_not_company'),
  ('UKG Ready',   'excluded', 'product_not_company'),
  ('Large Automotive OEMs', 'excluded', 'not_a_company'),
  ('FAA',         'excluded', 'not_a_company'),
  ('NSA',         'excluded', 'not_a_company'),
  ('UNICEF',      'excluded', 'not_a_company'),
  ('United Way',  'excluded', 'not_a_company'),
  ('Dow Jones Sustainability Index', 'excluded', 'not_a_company'),
  ('American Red Cross', 'excluded', 'not_a_company');

-- Seed: Industry restrictions (status = 'active', with allowed_industries)
insert into public.company_overrides (canonical_name, status, allowed_industries) values
  ('Starlink',       'active', '{Telecommunications,Technology}'),
  ('Capgemini',      'active', '{Consulting,"Enterprise Software",Technology,"Cloud Data Platform","Artificial Intelligence"}'),
  ('SAP',            'active', '{"Enterprise Software","Cloud Data Platform"}'),
  ('AWS',            'active', '{"Cloud Data Platform","Artificial Intelligence",Cybersecurity}'),
  ('Google Cloud',   'active', '{"Cloud Data Platform","Artificial Intelligence",Cybersecurity}'),
  ('EY',             'active', '{Consulting,Blockchain,Cybersecurity}'),
  ('Edelman',        'active', '{Consulting}'),
  ('BNY Mellon',     'active', '{Finance,"Financial Services",Consulting}'),
  ('Delta Airlines', 'active', '{Airline,Travel,Hospitality}'),
  ('Dow Jones',      'active', '{"Media & Entertainment","Financial Services"}'),
  ('Asics',          'active', '{Apparel}'),
  ('Michelin',       'active', '{"Manufacturing & Industrial"}');
