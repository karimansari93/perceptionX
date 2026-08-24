-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713143733; this file was
-- back-filled afterwards and therefore post-dates the deployment.


create table public.url_recency_cache_reclass_backup_2026_07 as
with base as (
  select id, url as u, lower(regexp_replace(domain,'^www\.','')) as d,
         extraction_method as old_extraction_method, recency_score as old_recency_score
  from public.url_recency_cache
  where extraction_method in ('not-found','problematic-domain') and manually_reviewed_at is null
),
owned as (select lower(domain) dom from public.company_owned_domains),
classified as (
  select b.id, b.old_extraction_method, b.old_recency_score,
    case
      when b.d in (select dom from owned) then 'owned-asset'
      when (b.d like '%instagram.com' and b.u ~* '/(p|reel|reels|tv)/')
        or (b.d like '%tiktok.com' and b.u ~* '/video/')
        or (b.d like '%facebook.com' and b.u ~* '/(posts|reel|reels|videos|watch|photo)') then 'social-post'
      when b.d ~ '(^|\.)glassdoor\.' or b.d ~ '(^|\.)ambitionbox\.com$' or b.d ~ '(^|\.)comparably\.com$'
        or b.d ~ '(^|\.)careerbliss\.com$' or b.d ~ '(^|\.)breakroom\.cc$' or b.d ~ '(^|\.)levels\.fyi$' or b.d ~ '(^|\.)zippia\.com$' then 'evergreen-domain'
      when b.d ~ '(^|\.)indeed\.' or b.d ~ '(^|\.)ziprecruiter\.com$' or b.d ~ '(^|\.)naukri\.com$'
        or b.d ~ '(^|\.)instahyre\.com$' or b.d ~ '(^|\.)iimjobs\.com$' or b.d ~ '(^|\.)wellfound\.com$' or b.d ~ '(^|\.)dataaijobs\.com$'
        or (b.d ~ '(^|\.)linkedin\.com$' and b.u ~* '/(in|hubs)/') or b.d like 'jobs.%' or b.d like 'careers.%' then 'evergreen-domain'
      when b.d ~ '(^|\.)quora\.com$' or b.d ~ '(^|\.)fishbowlapp\.com$' then 'evergreen-domain'
      when b.d ~ '(^|\.)amazon\.jobs$'
        or ((b.d ~ '(^|\.)nestle\.' or b.d ~ '(^|\.)unilever\.' or b.d ~ '(^|\.)(coca-cola|coca-colacompany)\.' or b.d ~ '(^|\.)mondelez'
             or b.d ~ '(^|\.)(heineken|theheinekencompany)\.' or b.d ~ '(^|\.)ambev\.' or b.d ~ '(^|\.)danone\.' or b.d ~ '(^|\.)keurig' or b.d ~ '(^|\.)generalmills\.'
             or b.d ~ '(^|\.)(colgate|colgatepalmolive)\.' or b.d ~ '(^|\.)cargill\.' or b.d ~ '(^|\.)kimberly-clark\.' or b.d ~ '(^|\.)redbull\.' or b.d ~ '(^|\.)bat\.com$'
             or b.d ~ '(^|\.)lilly\.' or b.d ~ '(^|\.)jnj\.' or b.d ~ '(^|\.)bcg\.' or b.d ~ '(^|\.)microsoft\.' or b.d ~ '(^|\.)accenture\.' or b.d ~ '(^|\.)pg\.' or b.d ~ 'procter')
            and b.u ~* '/(careers?|about|jobs|carreiras|carrieres|vagas|talent|early-careers|life-at|who-we-are|our-company|our-people|working-at|work-with-us|join)') then 'evergreen-domain'
      else 'stays-not-found'
    end as target_method,
    case
      when b.d in (select dom from owned) then 'r1_owned-asset'
      when (b.d like '%instagram.com' and b.u ~* '/(p|reel|reels|tv)/') or (b.d like '%tiktok.com' and b.u ~* '/video/') or (b.d like '%facebook.com' and b.u ~* '/(posts|reel|reels|videos|watch|photo)') then 'r2_social-post'
      when b.d ~ '(^|\.)glassdoor\.' or b.d ~ '(^|\.)ambitionbox\.com$' or b.d ~ '(^|\.)comparably\.com$' or b.d ~ '(^|\.)careerbliss\.com$' or b.d ~ '(^|\.)breakroom\.cc$' or b.d ~ '(^|\.)levels\.fyi$' or b.d ~ '(^|\.)zippia\.com$' then 'r3_review-index'
      when b.d ~ '(^|\.)indeed\.' or b.d ~ '(^|\.)ziprecruiter\.com$' or b.d ~ '(^|\.)naukri\.com$' or b.d ~ '(^|\.)instahyre\.com$' or b.d ~ '(^|\.)iimjobs\.com$' or b.d ~ '(^|\.)wellfound\.com$' or b.d ~ '(^|\.)dataaijobs\.com$' or (b.d ~ '(^|\.)linkedin\.com$' and b.u ~* '/(in|hubs)/') or b.d like 'jobs.%' or b.d like 'careers.%' then 'r4_job-listing'
      when b.d ~ '(^|\.)quora\.com$' or b.d ~ '(^|\.)fishbowlapp\.com$' then 'r5_qa-forum'
      else 'r6_competitor-hub'
    end as matched_rule,
    now() as backed_up_at
  from base b
)
select id, old_extraction_method, old_recency_score,
       target_method,
       (case target_method when 'owned-asset' then 93 when 'evergreen-domain' then 55 else null end)::integer as target_score,
       matched_rule, backed_up_at
from classified
where target_method <> 'stays-not-found';

alter table public.url_recency_cache_reclass_backup_2026_07 add primary key (id);

