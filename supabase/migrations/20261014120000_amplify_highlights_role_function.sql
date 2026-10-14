-- Amplify highlights by role and job function, plus Thermo Fisher's first
-- highlights.
--
-- A highlight is the specific page AI cites for a platform in a market (a
-- Reddit thread, a Glassdoor interview page). Until now there was one per
-- market x platform, so every recipient saw the same page. The recipient
-- already tells us two things before the routes step: employee or candidate,
-- and their kind of work. Both now narrow the highlight:
--
--   audience       'employee' | 'candidate' | NULL (either)
--   job_functions  the client's own job_function_context labels; NULL = any
--
-- The page picks the most specific match (audience beats function, then rank,
-- then citations). Existing highlights are NULL/NULL, so nothing changes for
-- Ford, PepsiCo or the rest.
--
-- Function still never selects a platform (docs/ACTIVATE_LINK_ROUTER.md). It
-- only picks which page inside a platform the recipient is shown.

alter table public.activate_route_highlights
  add column if not exists audience text
    check (audience is null or audience in ('employee', 'candidate')),
  add column if not exists job_functions text[];

-- Same function as 20261002 with two keys added to each highlight.
create or replace function public.activate_get_by_token(p_token text, p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_link public.activate_links; v_branding public.activate_branding;
  v_org public.organizations; v_entities jsonb;
  v_entity_names text[];
begin
  -- Single uniform failure: unknown, revoked and expired are one answer.
  select * into v_link from public.activate_links
  where token = p_token and revoked_at is null and (expires_at is null or expires_at > now());
  if v_link.id is null then return jsonb_build_object('error','not_found'); end if;

  select * into v_org from public.organizations where id = v_link.org_id;
  select * into v_branding from public.activate_branding where org_id = v_link.org_id;
  select entity_names into v_entity_names
  from public.activate_org_settings where org_id = v_link.org_id;
  if p_session_id is not null
     and not exists (select 1 from public.activate_link_events
       where link_id = v_link.id and session_id = p_session_id and event_type = 'open')
     and (select count(*) from public.activate_link_events
          where link_id = v_link.id and occurred_at > now() - interval '1 hour') < 5000
  then insert into public.activate_link_events (link_id, session_id, event_type)
       values (v_link.id, p_session_id, 'open'); end if;
  with ent as (
    select c.id, c.name from public.organization_companies oc
    join public.companies c on c.id = oc.company_id
    where oc.organization_id = v_link.org_id
      and (v_entity_names is null or c.name = any(v_entity_names))),
  em as (select distinct on (e.name, amm.market_code) e.name, amm.market_code, e.id
    from ent e join public.confirmed_prompts cp on cp.company_id = e.id
    join public.activate_market_map amm on amm.org_id = v_link.org_id
      and amm.location_context = cp.location_context
    order by e.name, amm.market_code, e.id)
  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) into v_entities
  from (select jsonb_build_object('id',(array_agg(e.id order by e.id))[1],'name',e.name,
          'markets', coalesce((select jsonb_object_agg(em.market_code, em.id) from em where em.name = e.name),'{}'::jsonb)) as row
        from ent e group by e.name) x;
  return jsonb_build_object(
    'org', jsonb_build_object(
      'display_name', coalesce(v_branding.display_name, v_org.name),
      'tagline', v_branding.tagline, 'blurb', v_branding.blurb,
      'logo_url', coalesce(v_branding.logo_url, v_org.logo_url),
      'logo_domain', v_branding.logo_domain, 'banner_url', v_branding.banner_url,
      'hero_image_url', v_branding.hero_image_url,
      'heading_font', v_branding.heading_font, 'body_font', v_branding.body_font,
      'heading_font_url', v_branding.heading_font_url, 'body_font_url', v_branding.body_font_url,
      'primary_color', coalesce(v_branding.primary_color,'#13274F'),
      'accent_color', coalesce(v_branding.accent_color,'#F59E0B')),
    'audience', v_link.audience,
    'prefill_market_code', v_link.prefill_market_code,
    'prefill_entity_company_id', v_link.prefill_entity_company_id,
    'entities', v_entities,
    'job_functions', coalesce((
      select jsonb_agg(f.job_function_context order by f.n desc)
      from (
        select cp.job_function_context, count(*) n
        from public.confirmed_prompts cp
        join public.organization_companies oc
          on oc.company_id = cp.company_id and oc.organization_id = v_link.org_id
        join public.companies c
          on c.id = cp.company_id
        where cp.is_active and coalesce(trim(cp.job_function_context),'') <> ''
          and (v_entity_names is null or c.name = any(v_entity_names))
        group by 1 order by 2 desc limit 24
      ) f), '[]'::jsonb),
    'coverage', coalesce((select jsonb_object_agg(mc.market_code, mc.people_pct)
      from public.activate_market_coverage mc where mc.org_id = v_link.org_id), '{}'::jsonb),
    'routes', coalesce((select jsonb_agg(jsonb_build_object(
        'market_code', r.market_code,'tier', r.tier,'channel', r.channel,'platform', r.platform,
        'destination_url', r.destination_url,'write_url', r.write_url,
        'rationale_stat', r.rationale_stat,'fit_note', r.fit_note,'is_local', r.is_local,
        'action_label', r.action_label,'is_listen_only', r.is_listen_only,
        'audience_functions', r.audience_functions,'audience_seniority', r.audience_seniority,
        'rank', r.rank,'use_direct_link', r.use_direct_link,'entity_company_id', r.entity_company_id)
      order by r.market_code nulls last, r.rank)
      from public.activate_routes r where r.org_id = v_link.org_id and r.active), '[]'::jsonb),
    'highlights', coalesce((select jsonb_agg(jsonb_build_object(
        'market_code', h.market_code,'platform', h.platform,'url', h.url,
        'label', h.label,'citations', h.citations,'rank', h.rank,
        'audience', h.audience,'job_functions', h.job_functions) order by h.rank)
      from public.activate_route_highlights h where h.org_id = v_link.org_id), '[]'::jsonb),
    'themes', coalesce((select jsonb_agg(jsonb_build_object(
        'market_code', t.market_code,'theme', t.theme,'detail', t.detail,'rank', t.rank) order by t.rank)
      from public.activate_market_themes t where t.org_id = v_link.org_id), '[]'::jsonb));
end $function$;

-------------------------------------------------------------------------------
-- Thermo Fisher Scientific highlights, from the 2026-09-30 to 2026-10-07
-- collection (DE 572, SG 613, US 575 answers). `citations` = answers in that
-- market citing the page. Every URL is a page cited in that market's answers,
-- in the form it was most often cited. Floor: 3 answers.
--
-- What the data says:
--   * Reddit: r/clinicalresearch is cited only for the Clinical Research and
--     Functional Service Provider functions (5.8% and 10.3% of their answers);
--     R&D, Operations and Sales answers cite r/biotech and never
--     r/clinicalresearch. So the clinical functions get a clinicalresearch
--     thread, everyone else keeps the r/biotech thread.
--   * Candidates: interview and application pages are cited on their own,
--     e.g. kununu /bewerbung in 12.9% of German answers, Glassdoor's interview
--     page in 6.6% of US and 5.9% of SG answers. A candidate is shown those
--     instead of the employee review page.
--   * Role-specific Glassdoor pages carry real weight: Sales Representative
--     reviews appear in 10.2% of US Sales answers; the CRA interview page and
--     Scientist interview page lead for Clinical Research and R&D in SG.
--
-- Not seeded: Sales/US Reddit (r/medicaldevices, r/labrats: 2 answers each),
-- r/clinicalresearch "Thermo FSP" (4 answers, all US, below what 1doofo2 has
-- for the same people), Operations/DE Glassdoor (glassdoor.ca, 3 answers).
--
-- Reddit threads must still take replies before a link goes out; Reddit could
-- not be checked from the build session.
-------------------------------------------------------------------------------
do $$
declare
  v_org uuid := '11ce6833-abe0-496b-8ffb-544a6e0cacc1';
  clin text[] := array['Clinical Research', 'Functional Service Provider'];
  rd_general text := 'https://www.reddit.com/r/biotech/comments/1bayiug/anyone_here_work_for_thermo_fisher_opinions/';
  rd_general_label text := '“Anyone here work for Thermo Fisher? Opinions” on r/biotech';
  gd_interview text := 'https://www.glassdoor.com/Interview/Thermo-Fisher-Scientific-Interview-Questions-E658.htm';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'Thermo Fisher org % not found; skipping highlights', v_org;
    return;
  end if;

  insert into public.activate_route_highlights
    (org_id, market_code, platform, url, label, citations, rank, audience, job_functions)
  values
    -- Reddit: everyone
    (v_org,'DE','reddit',rd_general,rd_general_label,15,1,null,null),
    (v_org,'SG','reddit',rd_general,rd_general_label,15,1,null,null),
    (v_org,'US','reddit',rd_general,rd_general_label,17,1,null,null),
    -- Reddit: clinical research and FSP
    (v_org,'DE','reddit','https://www.reddit.com/r/clinicalresearch/comments/1vze06j/thoughts_on_working_for_thermo_fisher_in_2026/',
     '“Thoughts on working for Thermo Fisher in 2026” on r/clinicalresearch',6,1,null,clin),
    (v_org,'SG','reddit','https://www.reddit.com/r/clinicalresearch/comments/1doofo2/working_for_thermo_fisher/',
     '“Working for Thermo Fisher” on r/clinicalresearch',4,1,null,clin),
    (v_org,'US','reddit','https://www.reddit.com/r/clinicalresearch/comments/1doofo2/working_for_thermo_fisher/',
     '“Working for Thermo Fisher” on r/clinicalresearch',7,1,null,clin),
    -- Reddit: candidates
    (v_org,'DE','reddit','https://www.reddit.com/r/biotech/comments/1m5pw9a/thermofisher_application_process_rant/',
     '“ThermoFisher application process rant” on r/biotech',8,1,'candidate',null),
    (v_org,'SG','reddit','https://www.reddit.com/r/biotech/comments/1ufqrh7/sick_of_interviewing_with_thermo_fisher/',
     '“Sick of interviewing with Thermo Fisher” on r/biotech',4,1,'candidate',null),
    (v_org,'US','reddit','https://www.reddit.com/r/biotech/comments/1ufqrh7/sick_of_interviewing_with_thermo_fisher/',
     '“Sick of interviewing with Thermo Fisher” on r/biotech',7,1,'candidate',null),

    -- Glassdoor: candidates
    (v_org,'DE','glassdoor',gd_interview,'Thermo Fisher Scientific interview reviews',25,1,'candidate',null),
    (v_org,'SG','glassdoor','https://www.glassdoor.sg/Interview/Thermo-Fisher-Scientific-Singapore-Interview-Questions-EI_IE658.0,24_IL.25,34_IM1123.htm',
     'Thermo Fisher Scientific Singapore interview reviews',36,1,'candidate',null),
    (v_org,'US','glassdoor',gd_interview,'Thermo Fisher Scientific interview reviews',36,1,'candidate',null),
    -- Glassdoor: by function
    (v_org,'DE','glassdoor','https://www.glassdoor.com/Interview/Thermo-Fisher-Scientific-Clinical-Research-Associate-Interview-Questions-EI_IE658.0,24_KO25,52.htm',
     'Clinical Research Associate interview reviews',6,1,'candidate',array['Clinical Research']),
    (v_org,'SG','glassdoor','https://www.glassdoor.com/Interview/Thermo-Fisher-Scientific-Clinical-Research-Associate-Interview-Questions-EI_IE658.0,24_KO25,52.htm',
     'Clinical Research Associate interview reviews',14,1,'candidate',array['Clinical Research']),
    (v_org,'SG','glassdoor','https://www.glassdoor.sg/Reviews/Thermo-Fisher-Scientific-Assistant-Clinical-Research-Associate-Reviews-EI_IE658.0,24_KO25,62.htm',
     'Assistant Clinical Research Associate reviews',7,1,'employee',array['Clinical Research']),
    (v_org,'SG','glassdoor','https://www.glassdoor.com/Interview/Thermo-Fisher-Scientific-Scientist-Interview-Questions-EI_IE658.0,24_KO25,34.htm',
     'Scientist interview reviews',13,1,'candidate',array['Research and Development']),
    (v_org,'US','glassdoor','https://www.glassdoor.com/Reviews/Thermo-Fisher-Scientific-Sales-Representative-Reviews-EI_IE658.0,24_KO25,45.htm',
     'Sales Representative reviews',29,1,'employee',array['Sales']),
    (v_org,'US','glassdoor','https://www.glassdoor.com/Interview/Thermo-Fisher-Scientific-Sales-Representative-Interview-Questions-EI_IE658.0,24_KO25,45.htm',
     'Sales Representative interview reviews',17,1,'candidate',array['Sales']),

    -- Indeed, kununu, Comparably: candidates
    (v_org,'DE','indeed','https://www.indeed.com/cmp/Thermo-Fisher-Scientific/interviews','Thermo Fisher Scientific interviews',7,1,'candidate',null),
    (v_org,'SG','indeed','https://sg.indeed.com/cmp/Thermo-Fisher-Scientific/interviews','Thermo Fisher Scientific interviews',8,1,'candidate',null),
    (v_org,'US','indeed','https://www.indeed.com/cmp/Thermo-Fisher-Scientific/interviews','Thermo Fisher Scientific interviews',26,1,'candidate',null),
    (v_org,'DE','kununu','https://www.kununu.com/de/thermo-fisher-scientific/bewerbung','Bewerbungserfahrungen bei Thermo Fisher Scientific',74,1,'candidate',null),
    (v_org,'DE','comparably','https://www.comparably.com/companies/thermo-fisher-scientific/interviews','Thermo Fisher Scientific interviews',5,1,'candidate',null),
    (v_org,'US','comparably','https://www.comparably.com/companies/thermo-fisher-scientific/interviews','Thermo Fisher Scientific interviews',16,1,'candidate',null)
  on conflict (org_id, coalesce(market_code,'--'), platform, url) do update set
    label = excluded.label, citations = excluded.citations, rank = excluded.rank,
    audience = excluded.audience, job_functions = excluded.job_functions;
end $$;
