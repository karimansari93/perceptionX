-- GoFundMe clean-up (Karim, 2026-10-23).
--
-- GoFundMe's own prompts are its Crowfunding / Software & Technology sets
-- (Global, AR, GB, IE, MX). Everything else filed under its companies is not
-- GoFundMe's:
--   * 17 stray prompts created 2026-03-09 (16 "Artificial Intelligence in
--     India", 1 "Financial Services in United States"), swept into the
--     2026-03-25 run: 97 answers saved as GoFundMe, tagged India / United
--     States. They put India and United States in the dashboard's location
--     filter. No themes.
--   * 2,541 legacy Index prompts (2026-03-30 .. 04-13) whose answers are all
--     for_index rows with no company, plus 99 never-answered leftovers from
--     the same batches. The other 5,562 legacy Index prompts already have no
--     company; the rankings views join prompts by id and read industry and
--     location only, so the Index is unaffected.
--
-- Changes (every row backed up first; rollback = copy company_id / industry
-- values back from the backup tables):
--   1. The 97 stray answers lose their company, and so do the 672 foreign
--      prompts with no company-less twin. The other 1,985 are duplicates of
--      existing Index prompts and stay put (see gfm_foreign_prompts).
--   2. "Crowfunding" -> "Crowdfunding" as the industry label on GoFundMe's
--      companies, company_industries and prompts' industry_context. Prompt
--      TEXT is left as it was asked: the answers were given to that wording.
--
-- Run public.refresh_organization_metrics('10dcd559-2f84-4ac6-9f2c-b3661414ae00')
-- afterwards (outside this migration) to rebuild the dashboard stats.

create temporary table gfm_companies on commit drop as
select oc.company_id
from public.organization_companies oc
where oc.organization_id = '10dcd559-2f84-4ac6-9f2c-b3661414ae00';

create temporary table gfm_foreign_prompts on commit drop as
select cp.id,
  -- idx_unique_discovery_prompts_not_null: a company-less prompt with a
  -- location must be unique on (text, type, industry, location). 1,985 of
  -- these are exact copies of existing company-less Index prompts; they keep
  -- their company_id until the Index copies are merged (separate task, it
  -- re-points Index answers). Their answers aren't GoFundMe's either way.
  exists (
    select 1 from public.confirmed_prompts x
    where x.company_id is null and x.location_context is not null
      and x.prompt_text = cp.prompt_text and x.prompt_type = cp.prompt_type
      and x.industry_context is not distinct from cp.industry_context
      and x.location_context = cp.location_context
  ) as has_indexed_twin
from public.confirmed_prompts cp
where cp.company_id in (select company_id from gfm_companies)
  and coalesce(cp.industry_context, '') not in ('Crowfunding', 'Software & Technology');

-- 0. Backups ----------------------------------------------------------------
create table public.backup_20261023_gofundme_prompts as
select cp.id, cp.company_id, cp.industry_context
from public.confirmed_prompts cp
where cp.company_id in (select company_id from gfm_companies);

create table public.backup_20261023_gofundme_responses as
select pr.id, pr.company_id
from public.prompt_responses pr
where pr.company_id in (select company_id from gfm_companies)
  and pr.confirmed_prompt_id in (select id from gfm_foreign_prompts);

create table public.backup_20261023_gofundme_companies as
select c.id, c.industry from public.companies c
where c.id in (select company_id from gfm_companies);

create table public.backup_20261023_gofundme_company_industries as
select ci.* from public.company_industries ci
where ci.company_id in (select company_id from gfm_companies);

-- 1. Strays and legacy Index prompts off GoFundMe ----------------------------
update public.prompt_responses
set company_id = null
where id in (select id from public.backup_20261023_gofundme_responses);

update public.confirmed_prompts
set company_id = null
where id in (select id from gfm_foreign_prompts where not has_indexed_twin);

-- 2. Industry label spelling -------------------------------------------------
update public.companies
set industry = 'Crowdfunding'
where id in (select company_id from gfm_companies) and industry = 'Crowfunding';

update public.company_industries
set industry = 'Crowdfunding'
where company_id in (select company_id from gfm_companies) and industry = 'Crowfunding';

update public.confirmed_prompts
set industry_context = 'Crowdfunding'
where company_id in (select company_id from gfm_companies) and industry_context = 'Crowfunding';
