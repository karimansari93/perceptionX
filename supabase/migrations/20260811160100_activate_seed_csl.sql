-- Activate seed for the CSL org: branding, market map, consent row (pending),
-- and the manually curated route table from the Q3 2026 baseline.
-- Spec: docs/ACTIVATE_LINK_ROUTER.md — routes are hand-curated, never generated
-- from citation counts.
--
-- DE/CH rows ship inactive: kununu citations fragment across 6+ CSL-family
-- profiles (the most-cited German profile is not the one CSL listed at intake),
-- and the client's works-council review gates their outreach. When kununu
-- consolidation lands, re-point destination_url at the CANONICAL profile CSL
-- wants weight to accrue on — not the currently-most-cited one — then activate.
--
-- write_url stays NULL until each platform's write endpoint is resolved by
-- hand; the page falls back to destination_url.
--
-- Idempotent: re-running refreshes URLs/stats/ranks but never overwrites an
-- admin's `active` toggle.

do $$
declare
  v_org uuid := 'ebbe52ed-0c8e-4d5b-9526-67496e09c6b4';  -- CSL organization
  v_behring uuid := '0c335544-e9a0-4713-897b-3fd28f315d37';
  v_limited uuid := '3b569480-a7e4-44e8-b742-59f723fefb6e';
  v_seqirus uuid := '55cd3939-7ae2-4c8e-8488-c98f47482746';
  v_vifor uuid := '53d125b2-9f1a-4cac-aa85-da1b660306c8';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise notice 'CSL org % not found; skipping Activate seed', v_org;
    return;
  end if;

  -- Consent explicitly pending: links are not mintable until this is confirmed.
  insert into public.activate_org_settings (org_id, consent_note)
  values (v_org, 'Pending: client consent conversation not yet held')
  on conflict (org_id) do nothing;

  insert into public.activate_branding
    (org_id, display_name, tagline, blurb, primary_color, accent_color)
  values
    (v_org, 'CSL', 'Life at CSL',
     'AI assistants are shaping how candidates see us — here''s where they listen.',
     '#C8102E', '#F5A800')
  on conflict (org_id) do nothing;

  insert into public.activate_market_map (org_id, market_code, location_context)
  values
    (v_org, 'DE', 'Germany'),
    (v_org, 'CH', 'Switzerland'),
    (v_org, 'GB', 'United Kingdom'),
    (v_org, 'US', 'United States'),
    (v_org, 'AU', 'Australia')
  on conflict do nothing;

  insert into public.activate_routes
    (org_id, entity_company_id, market_code, tier, platform, destination_url,
     rationale_stat, rank, active, use_direct_link)
  values
    -- Germany — tier 1, INACTIVE pending kununu consolidation + client review
    (v_org, v_behring, 'DE', 1, 'kununu', 'https://www.kununu.com/de/csl-behring-deutschland',
     'kununu shows up in 55.1% of AI answers about working at CSL in Germany.', 1, false, false),
    (v_org, v_vifor, 'DE', 1, 'kununu', 'https://www.kununu.com/de/vifor',
     'kununu shows up in 55.1% of AI answers about working at CSL in Germany.', 1, false, false),
    (v_org, null, 'DE', 1, 'kununu', 'https://www.kununu.com/de/csl-behring-deutschland',
     'kununu shows up in 55.1% of AI answers about working at CSL in Germany.', 1, false, false),
    (v_org, null, 'DE', 1, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     'Glassdoor appears in 19.4% of AI answers about working at CSL in Germany.', 2, false, true),
    (v_org, null, 'DE', 1, 'indeed', 'https://www.indeed.com/cmp/csl',
     'Indeed appears in 17.7% of AI answers about working at CSL in Germany.', 3, false, true),

    -- Switzerland — tier 1, INACTIVE (same gates as Germany)
    (v_org, v_behring, 'CH', 1, 'kununu', 'https://www.kununu.com/ch/csl-behring1-schweiz',
     'kununu shows up in 47.0% of AI answers about working at CSL in Switzerland.', 1, false, false),
    (v_org, v_vifor, 'CH', 1, 'kununu', 'https://www.kununu.com/ch/csl-vifor1',
     'kununu shows up in 47.0% of AI answers about working at CSL in Switzerland.', 1, false, false),
    (v_org, null, 'CH', 1, 'kununu', 'https://www.kununu.com/ch/csl-behring1-schweiz',
     'kununu shows up in 47.0% of AI answers about working at CSL in Switzerland.', 1, false, false),
    (v_org, null, 'CH', 1, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     'Glassdoor appears in 19.3% of AI answers about working at CSL in Switzerland.', 2, false, true),

    -- United Kingdom — tier 1, live
    (v_org, null, 'GB', 1, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     'Glassdoor shows up in 53.7% of AI answers about working at CSL in the UK.', 1, true, true),
    (v_org, null, 'GB', 1, 'indeed', 'https://www.indeed.com/cmp/csl',
     'Indeed appears in 47.4% of AI answers about working at CSL in the UK.', 2, true, true),

    -- United States — tier 1, live
    (v_org, null, 'US', 1, 'indeed', 'https://www.indeed.com/cmp/csl',
     'Indeed shows up in 51.2% of AI answers about working at CSL in the US.', 1, true, true),
    (v_org, null, 'US', 1, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     'Glassdoor appears in 48.0% of AI answers about working at CSL in the US.', 2, true, true),

    -- Australia — tier 1, live
    (v_org, null, 'AU', 1, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     'Glassdoor shows up in 44.7% of AI answers about working at CSL in Australia.', 1, true, true),
    (v_org, v_limited, 'AU', 1, 'seek', 'https://au.seek.com/companies/csl-limited-436233',
     'Seek appears in 34.5% of AI answers about working at CSL in Australia.', 2, true, false),
    (v_org, v_seqirus, 'AU', 1, 'seek', 'https://au.seek.com/companies/csl-seqirus-814864',
     'Seek appears in 34.5% of AI answers about working at CSL in Australia.', 2, true, false),
    (v_org, null, 'AU', 1, 'seek', 'https://au.seek.com/companies/csl-limited-436233',
     'Seek appears in 34.5% of AI answers about working at CSL in Australia.', 2, true, false),
    (v_org, null, 'AU', 1, 'indeed', 'https://www.indeed.com/cmp/csl',
     'Indeed appears in 30.9% of AI answers about working at CSL in Australia.', 3, true, true),

    -- Tier 2 — known platforms, no measured rationale
    (v_org, null, 'CA', 2, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     null, 1, true, true),
    (v_org, null, 'CA', 2, 'indeed', 'https://www.indeed.com/cmp/csl', null, 2, true, true),
    (v_org, null, 'IE', 2, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     null, 1, true, true),
    (v_org, null, 'IE', 2, 'indeed', 'https://www.indeed.com/cmp/csl', null, 2, true, true),

    -- Tier 3 — global default: Glassdoor + Indeed only (LinkedIn is a managed
    -- profile — client-influenced — with nothing for a recipient to write)
    (v_org, null, null, 3, 'glassdoor', 'https://www.glassdoor.com/Overview/Working-at-CSL-EI_IE27527.htm',
     null, 1, true, true),
    (v_org, null, null, 3, 'indeed', 'https://www.indeed.com/cmp/csl', null, 2, true, true)
  on conflict (org_id, coalesce(market_code, '--'), platform,
               coalesce(entity_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    destination_url = excluded.destination_url,
    rationale_stat = excluded.rationale_stat,
    tier = excluded.tier,
    rank = excluded.rank,
    use_direct_link = excluded.use_direct_link;
end $$;
