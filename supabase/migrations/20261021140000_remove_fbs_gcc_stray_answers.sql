-- Remove 8 stray FBS India answers (Karim, 2026-10-21).
--
-- The first "Technology Services and Global Capability Centres" run for
-- Ford Business Solutions India covered all four prompt types. It was
-- stopped and requeued as discovery and competitive only (the types whose
-- wording carries the industry); experience and informational went back to
-- the original Technology prompts. These 8 answers (Data Insights &
-- Analytics; 4 experience, 4 informational, one per model) came in before
-- the stop, on prompts now inactive. The dashboard does not filter on
-- is_active, so they would count in FBS's October figures.
--
-- ai_themes and competitor_themes cascade on delete; both are backed up.

create temp table _stray (id uuid primary key) on commit drop;
insert into _stray values
  ('e88b4c5a-ad0c-4a4e-8f4c-17cb50425153'),
  ('a5066f9a-1d9b-45b9-972d-b3d8b44c9e35'),
  ('7ff324b2-9f27-495c-8e16-36b586d9f63d'),
  ('93403099-4c32-47d8-8ebb-c34d876996a9'),
  ('432b26f1-95d7-4e0e-a4dd-08f5ed445902'),
  ('9d58eb1e-b6e2-4b35-a2be-6d78294e54f1'),
  ('a47c31c9-7366-4bb5-82e5-ea226c0ca7d0'),
  ('a44924aa-3941-45ad-a2c7-1408951db605');

-- 0. Backups ---------------------------------------------------------------
create table if not exists public.backup_20261021_fbs_gcc_stray_responses as
select pr.* from public.prompt_responses pr join _stray s on s.id = pr.id;
alter table public.backup_20261021_fbs_gcc_stray_responses enable row level security;

create table if not exists public.backup_20261021_fbs_gcc_stray_themes as
select t.* from public.ai_themes t join _stray s on s.id = t.response_id;
alter table public.backup_20261021_fbs_gcc_stray_themes enable row level security;

create table if not exists public.backup_20261021_fbs_gcc_stray_competitor_themes as
select t.* from public.competitor_themes t join _stray s on s.id = t.response_id;
alter table public.backup_20261021_fbs_gcc_stray_competitor_themes enable row level security;

-- 1. Delete (themes cascade) -------------------------------------------------
delete from public.prompt_responses pr using _stray s where pr.id = s.id;

-- 2. Queue metrics rebuild ---------------------------------------------------
insert into public.company_metrics_dirty (company_id)
values ('6013cdc4-5936-4436-86fe-852382469f94')
on conflict (company_id) do nothing;
