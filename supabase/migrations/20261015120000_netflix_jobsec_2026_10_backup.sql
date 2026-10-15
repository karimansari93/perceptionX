-- Back up the October 2026 Netflix "job-security" answers before deleting
-- them so they can be re-collected after the Oct 14 layoff announcement.
--
-- Scope: 284 active confirmed_prompts (Netflix org, companies.name =
-- 'Netflix', attribute_id = 'job-security'), response_month = 2026-10-01,
-- collected 2026-10-09 20:27 to 2026-10-11 04:09 UTC. Karim approved the
-- delete on 2026-10-15, including backing up and deleting theme_batch_items
-- as in the 2026-10-14 stray-template cleanup.
--
-- Applied as migration backup_netflix_jobsec_2026_10 and verified:
-- 1417 responses, 5938 ai_themes, 1895 competitor_themes, 1417
-- theme_batch_items, all ids and timestamps identical to the live rows.
-- The delete runs in the one-off edge function zz-netflix-jobsec-purge, in a
-- single transaction that rolls back unless every count matches.
-- Ran 2026-10-15: deleted 1417 theme_batch_items, 5938 ai_themes, 1895
-- competitor_themes and 1417 prompt_responses. Netflix October then had
-- 16749 answers; gaps were the 284 job-security prompts (all five models)
-- plus 31 pre-existing slots (8 Claude, 23 AI Overviews). The function was
-- redeployed as a no-op and its source is in this branch's history.

create table public.backup_netflix_jobsec_2026_10 as
select pr.* from public.prompt_responses pr
where pr.response_month = '2026-10-01'
  and pr.confirmed_prompt_id in (
    select cp.id from public.confirmed_prompts cp
    where cp.attribute_id = 'job-security' and cp.is_active
      and cp.company_id in (
        select c.id from public.organization_companies oc
        join public.companies c on c.id = oc.company_id
        where oc.organization_id = '03388b70-2563-497c-8043-2b3340823608'
          and c.name = 'Netflix' and length(c.name) >= 3));

create table public.backup_netflix_jobsec_2026_10_themes as
select t.* from public.ai_themes t
where t.response_id in (select id from public.backup_netflix_jobsec_2026_10);

create table public.backup_netflix_jobsec_2026_10_competitor_themes as
select t.* from public.competitor_themes t
where t.response_id in (select id from public.backup_netflix_jobsec_2026_10);

create table public.backup_netflix_jobsec_2026_10_batch_items as
select i.* from public.theme_batch_items i
where i.response_id in (select id from public.backup_netflix_jobsec_2026_10);

alter table public.backup_netflix_jobsec_2026_10 enable row level security;
alter table public.backup_netflix_jobsec_2026_10_themes enable row level security;
alter table public.backup_netflix_jobsec_2026_10_competitor_themes enable row level security;
alter table public.backup_netflix_jobsec_2026_10_batch_items enable row level security;
