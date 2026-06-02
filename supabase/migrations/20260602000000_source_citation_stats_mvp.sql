-- Source-activation intelligence (MVP)
--
-- Goal: answer "which sources should I activate to improve visibility for
-- <theme> in <market / function / industry>?" directly from our own database.
-- We scan every cited URL across all responses, resolve each cited domain to
-- its canonical source family, and aggregate raw citation frequency sliced by
-- the dimensions that already live on confirmed_prompts (industry / job
-- function / location / theme) plus the TalentX attribute from ai_themes.
--
-- Resolution chain:
--   prompt_responses.citations[].domain
--     -> source_domains.domain            (10k+ classified variants)
--        -> source_families               (canonical source, e.g. Glassdoor)
--           -> source_taxonomy            (super-category)
--
-- MVP scope per product decision: PURE citation frequency. No winner-
-- correlation/lift and no actionability weighting yet. Actionability flags
-- (accepts_company_responses, has_company_dashboard) are exposed as metadata
-- only so the UI can annotate without changing rank order. Time-series
-- snapshots and correlation scoring build on this foundation later.

-- 1. Sliced aggregate table -------------------------------------------------

create table if not exists public.source_citation_stats (
  family_id        uuid    not null references public.source_families(id) on delete cascade,
  -- 'global' = across everything; otherwise the slicing dimension.
  dimension        text    not null check (dimension in (
                     'global','industry','job_function','location','theme','talentx_attribute')),
  -- The specific value within the dimension ('' for global).
  dimension_value  text    not null default '',
  -- Reserved for per-model slicing; MVP stores a single 'all' rollup.
  ai_model         text    not null default 'all',
  citation_count   integer not null default 0,   -- total cited URLs resolving to this family in the slice
  response_count   integer not null default 0,   -- distinct responses citing the family in the slice
  company_count    integer not null default 0,   -- distinct companies whose responses cite the family
  computed_at      timestamptz not null default now(),
  primary key (family_id, dimension, dimension_value, ai_model)
);

comment on table public.source_citation_stats is
  'Raw citation-frequency aggregates per source family, sliced by dimension (global/industry/job_function/location/theme/talentx_attribute). Powers source-activation recommendations. Rebuilt wholesale by refresh_source_citation_stats().';

create index if not exists idx_source_citation_stats_lookup
  on public.source_citation_stats (dimension, dimension_value, citation_count desc);

alter table public.source_citation_stats enable row level security;

-- Mirror the rest of the source.* tables: world-readable aggregate, admin write.
drop policy if exists "public_read" on public.source_citation_stats;
create policy "public_read" on public.source_citation_stats
  for select to anon, authenticated using (true);

drop policy if exists "admin_write" on public.source_citation_stats;
create policy "admin_write" on public.source_citation_stats
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. Refresh function -------------------------------------------------------
-- Wholesale rebuild. Cheap enough to run on a schedule; called manually for
-- the MVP. SECURITY DEFINER so a scheduled/service caller can read the
-- RLS-protected source tables (prompt_responses, ai_themes, confirmed_prompts).

create or replace function public.refresh_source_citation_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- One row per resolved citation occurrence, carrying its response, company,
  -- and prompt-level context. Built once and reused across every dimension.
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

  -- global
  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'global', '',
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  group by family_id;

  -- industry
  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'industry', industry_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where industry_context is not null and industry_context <> ''
  group by family_id, industry_context;

  -- job_function
  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'job_function', job_function_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where job_function_context is not null and job_function_context <> ''
  group by family_id, job_function_context;

  -- location (market)
  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'location', location_context,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where location_context is not null and location_context <> ''
  group by family_id, location_context;

  -- theme (prompt_theme)
  insert into public.source_citation_stats
    (family_id, dimension, dimension_value, citation_count, response_count, company_count)
  select family_id, 'theme', prompt_theme,
         count(*), count(distinct response_id), count(distinct company_id)
  from _cite_base
  where prompt_theme is not null and prompt_theme <> ''
  group by family_id, prompt_theme;

  -- talentx_attribute (from ai_themes; dedupe attribute per response so a
  -- response with several theme rows for the same attribute counts once)
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

comment on function public.refresh_source_citation_stats() is
  'Rebuilds public.source_citation_stats from prompt_responses citations resolved to source families, sliced by industry/job_function/location/theme/talentx_attribute plus global.';

-- 3. Recommendation query ---------------------------------------------------
-- Top source families to activate for a given slice, ranked purely by
-- citation frequency. Actionability flags returned as annotation only.

create or replace function public.recommend_sources(
  p_dimension text default 'global',
  p_value     text default '',
  p_limit     int  default 10
)
returns table (
  rank                       bigint,
  family_id                  uuid,
  source_family              text,
  super_category             text,
  homepage_url               text,
  accepts_company_responses  boolean,
  has_company_dashboard      boolean,
  citation_count             integer,
  response_count             integer,
  company_count              integer,
  citation_share             numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with slice as (
    select *
    from public.source_citation_stats
    where dimension = p_dimension
      and dimension_value = coalesce(p_value, '')
      and ai_model = 'all'
  ),
  total as (select nullif(sum(citation_count), 0) as c from slice)
  select
    row_number() over (order by s.citation_count desc) as rank,
    s.family_id,
    sf.name,
    st.super_category,
    sf.homepage_url,
    sf.accepts_company_responses,
    sf.has_company_dashboard,
    s.citation_count,
    s.response_count,
    s.company_count,
    round(100.0 * s.citation_count / (select c from total), 2) as citation_share
  from slice s
  join public.source_families sf on sf.id = s.family_id
  left join public.source_taxonomy st on st.id = sf.taxonomy_id
  order by s.citation_count desc
  limit p_limit;
$$;

comment on function public.recommend_sources(text, text, int) is
  'Returns the top source families for a slice (dimension + value), ranked by raw citation frequency. dimension in (global,industry,job_function,location,theme,talentx_attribute).';

grant execute on function public.recommend_sources(text, text, int) to anon, authenticated;
