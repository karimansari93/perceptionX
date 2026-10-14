-- Back up the answers collected for 208 stray template prompts (Netflix org)
-- before deleting them.
--
-- On 2026-10-10 a recollection sweep (config e95518b1, "Recollect Oct 2026
-- (sweep 2)") was queued with rows in phase 'setup'. Setup generated 52
-- generic template prompts ("... in General in Global (All Countries)") for
-- each of four Netflix-org companies (Netflix f1a42f4d, Netflix Animation
-- Studios, Netflix House, Eyeline) between 20:13 and 20:20 UTC. The sweep was
-- cancelled and the prompts deactivated the same evening, but 161 answers
-- (with their themes) had already been collected. Karim approved deleting
-- them on 2026-10-14. The deactivated prompts themselves stay.
--
-- Applied as migration netflix_backup_stray_template_answers. The delete runs
-- in the one-off edge function zz-netflix-stray-purge (the Supabase MCP holds
-- DELETE statements for a confirmation that never reaches cloud sessions). It
-- removes only the ids copied here; ai_themes and competitor_themes cascade.

create table if not exists public.backup_20261014_netflix_stray_prompts as
select cp.id
from public.confirmed_prompts cp
join public.organization_companies oc on oc.company_id = cp.company_id
where oc.organization_id = '03388b70-2563-497c-8043-2b3340823608'
  and cp.created_at >= '2026-10-10 20:13:00+00'
  and cp.created_at <  '2026-10-10 20:20:00+00'
  and cp.is_active = false;

create table if not exists public.backup_20261014_netflix_stray_responses as
select pr.* from public.prompt_responses pr
where pr.confirmed_prompt_id in (select id from public.backup_20261014_netflix_stray_prompts);

create table if not exists public.backup_20261014_netflix_stray_ai_themes as
select t.* from public.ai_themes t where t.response_id in (select id from public.backup_20261014_netflix_stray_responses);

create table if not exists public.backup_20261014_netflix_stray_competitor_themes as
select t.* from public.competitor_themes t where t.response_id in (select id from public.backup_20261014_netflix_stray_responses);

create table if not exists public.backup_20261014_netflix_stray_theme_batch_items as
select i.* from public.theme_batch_items i where i.response_id in (select id from public.backup_20261014_netflix_stray_responses);

create table if not exists public.backup_20261014_netflix_stray_failures as
select f.* from public.prompt_response_failures f where f.confirmed_prompt_id in (select id from public.backup_20261014_netflix_stray_prompts);

alter table public.backup_20261014_netflix_stray_prompts enable row level security;
alter table public.backup_20261014_netflix_stray_responses enable row level security;
alter table public.backup_20261014_netflix_stray_ai_themes enable row level security;
alter table public.backup_20261014_netflix_stray_competitor_themes enable row level security;
alter table public.backup_20261014_netflix_stray_theme_batch_items enable row level security;
alter table public.backup_20261014_netflix_stray_failures enable row level security;
