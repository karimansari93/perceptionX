-- Patch refresh_source_citation_stats(): skip source_domains rows whose
-- family_id is null (recorded-but-unclassified variants), which otherwise
-- violate the not-null family_id constraint on source_citation_stats.
--
-- This is an idempotent CREATE OR REPLACE; the body matches the corrected
-- definition already inlined in 20260602000000 (kept as a separate file so
-- the remote migration history stays in sync with the repo).

create or replace function public.refresh_source_citation_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  create temporary table _cite_base on commit drop as
  select
    pr.id                     as response_id,
    pr.company_id             as company_id,
    sd.family_id              as family_id,
    cp.industry_context       as industry_context,
    cp.job_function_context   as job_function_context,
    cp.location_context       as location_context,
    cp.prompt_theme           as prompt_theme
  from public.prompt_responses pr
  cross join lateral jsonb_array_elements(pr.citations) c
  join public.source_domains sd
    on sd.domain = lower(c->>'domain')
   and sd.family_id is not null
  left join public.confirmed_prompts cp
    on cp.id = pr.confirmed_prompt_id
  where jsonb_typeof(pr.citations) = 'array'
    and c->>'domain' is not null;

  create index on _cite_base (response_id);

  delete from public.source_citation_stats;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'global', '',
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base group by family_id;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'industry', industry_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base where industry_context is not null and industry_context <> ''
  group by family_id, industry_context;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'job_function', job_function_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base where job_function_context is not null and job_function_context <> ''
  group by family_id, job_function_context;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'location', location_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base where location_context is not null and location_context <> ''
  group by family_id, location_context;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'theme', prompt_theme,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base where prompt_theme is not null and prompt_theme <> ''
  group by family_id, prompt_theme;

  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select b.family_id, 'talentx_attribute', t.talentx_attribute_name,
         count(*), count(distinct b.response_id), count(distinct b.company_id)
  from _cite_base b
  join (
    select distinct response_id, talentx_attribute_name
    from public.ai_themes
    where talentx_attribute_name is not null and talentx_attribute_name <> ''
  ) t on t.response_id = b.response_id
  group by b.family_id, t.talentx_attribute_name;
end;
$$;
