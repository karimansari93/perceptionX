-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260814121222; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- One number instead of many. Per-platform percentages turned the routes page
-- into a dashboard; what a recipient needs is the single fact that these
-- places account for most of what AI says, then the places themselves.
--
-- people_pct = % of that market's answers citing ANY of the platforms actually
-- listed on the page. Computed over listed (non-listen-only) routes only, so
-- the claim "these places" is exactly true.
create table if not exists public.activate_market_coverage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  market_code text not null check (market_code ~ '^[A-Z]{2}$'),
  people_pct numeric(4,1) not null,
  computed_at timestamptz not null default now(),
  primary key (org_id, market_code)
);

alter table public.activate_market_coverage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
    and tablename='activate_market_coverage' and policyname='activate_market_coverage_admin_all') then
    create policy activate_market_coverage_admin_all on public.activate_market_coverage
      for all using (is_admin()) with check (is_admin());
  end if;
end $$;

with pat as (
  select * from (values
    ('glassdoor','%glassdoor%'),('indeed','%indeed%'),('kununu','%kununu%'),
    ('ambitionbox','%ambitionbox%'),('undelucram','%undelucram%'),('profession','%profession.hu%'),
    ('infojobs','%infojobs%'),('seek','%seek.com%'),('comparably','%comparably%'),
    ('openwork','%openwork%'),('jobtalk','%jobtalk%'),('jobplanet','%jobplanet%'),
    ('gowork','%gowork.pl%'),('workventure','%workventure%'),('reddit','%reddit%'),
    ('quora','%quora%'),('blind','%teamblind%'),('fourprogrammers','%4programmers%'),
    ('linkedin','%linkedin%'),('instagram','%instagram%'),('facebook','%facebook%'),
    ('tiktok','%tiktok%'),('note','note.com'),('naver','blog.naver.com'),('brunch','%brunch.co.kr%')
  ) as t(platform, pattern)
),
listed as (
  select distinct r.org_id, r.market_code, r.platform
  from activate_routes r
  where r.active and not r.is_listen_only and r.market_code is not null
),
resp as (
  select amm.org_id, amm.market_code, pr.id, pr.canonical_citations
  from prompt_responses pr
  join confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
  join activate_market_map amm on amm.location_context = cp.location_context
  join organization_companies oc
    on oc.organization_id = amm.org_id and oc.company_id = pr.company_id
  where pr.collection_cycle = '2026-07-01'
),
tot as (select org_id, market_code, count(*)::numeric n from resp group by 1,2),
hit as (
  select distinct r.org_id, r.market_code, r.id
  from resp r
  cross join lateral jsonb_array_elements(coalesce(r.canonical_citations,'[]'::jsonb)) c
  join pat p on lower(c->>'domain') like p.pattern
  join listed l on l.org_id = r.org_id and l.market_code = r.market_code and l.platform = p.platform
)
insert into public.activate_market_coverage (org_id, market_code, people_pct)
select t.org_id, t.market_code,
       least(99.0, round(100.0 * count(distinct h.id) / t.n, 1))
from tot t left join hit h on h.org_id = t.org_id and h.market_code = t.market_code
group by t.org_id, t.market_code, t.n
on conflict (org_id, market_code) do update
  set people_pct = excluded.people_pct, computed_at = now();
