-- Thermo Fisher Scientific: count subsidiaries and short names as Thermo.
--
-- Two gaps, both found 2026-10-13 on the Thermo Fisher dashboard:
--
-- 1. Visibility. analyze-response matches the literal company name
--    ("Thermo Fisher Scientific"), so answers that say "Thermo Fisher",
--    "PPD", "Patheon" or "Fisher Scientific" were stored with
--    company_mentioned = false. Sep 2026: 18 of 201 discovery answers missed
--    (13 say "Thermo Fisher", 5 name only a subsidiary). Same again in Oct.
--    Fix: regex aliases in company_mention_aliases (the BEFORE INSERT/UPDATE
--    trigger applies them to every new response) plus a one-off backfill.
--
-- 2. Competitors. PPD, Patheon and Fisher Scientific were separate canonical
--    entities, so they showed up as Thermo's own competitors (338 Thermo
--    answers) and as separate employers for other companies. Fix: merge them
--    into the Thermo Fisher Scientific canonical, same as the admin
--    canonicalization tab's "merge into" action. Moving the aliases fires
--    trg_entity_aliases_recanon_upd, which recomputes canonical_competitors.
--    Outside Thermo this touches 13 CSL Seqirus / CSL Behring answers and
--    2 Al Kabeer Food answers.
--
-- Deliberately not aliased: "Pantheon" (a different company; the canonical
-- "Pantheon Platform" is unrelated), "Thermo Scientific" (no missed answers).
--
-- Rollback reference (state before this migration):
--   canonical_entities: PPD 6f7eadca-eeac-4265-8f7c-6ce9034fd493,
--     Patheon b1e4ef01-08e5-432e-b9e3-402d700f49ad,
--     Fisher Scientific f255cb27-52dc-4ecf-8785-cfd7dbfda1b4
--     (all entity_type 'other', active).
--   entity_aliases moved: f75d146f (PPD), 67c96f1c (PPD Clinical Research
--     Services), 9add5530 (PPD Germany), c8a77c6a (PPD Clinical Research)
--     from PPD; 54a5d53d (Patheon) from Patheon; 06f9ad56 (Fisher
--     Scientific) from Fisher Scientific.
--   company_mentioned backfill: 241 Thermo responses, every one matching the
--     predicate below while false.

-- 1a. Mention aliases ------------------------------------------------------
insert into public.company_mention_aliases (company_name, alias, match_type, locale, notes) values
  ('Thermo Fisher Scientific', '\mThermo\s?Fisher\M',      'regex', null, 'Short name: Thermo Fisher / ThermoFisher'),
  ('Thermo Fisher Scientific', '\mPPD\M',                  'regex', null, 'PPD, clinical research business acquired Dec 2021'),
  ('Thermo Fisher Scientific', '\mPatheon\M',              'regex', null, 'Patheon, CDMO business acquired 2017'),
  ('Thermo Fisher Scientific', '\mFisher Scientific\M',    'regex', null, 'Fisher Scientific, distribution brand')
on conflict (lower(company_name), lower(alias)) do nothing;

-- 1b. Backfill company_mentioned (false -> true only) ----------------------
update public.prompt_responses pr
set company_mentioned = true
from public.confirmed_prompts cp
where cp.id = pr.confirmed_prompt_id
  and coalesce(pr.company_id, cp.company_id) = '74179bad-6411-44fc-9c89-e10868472924'
  and coalesce(pr.company_mentioned, false) = false
  and (   pr.response_text ~* '\mThermo\s?Fisher\M'
       or pr.response_text ~* '\mPPD\M'
       or pr.response_text ~* '\mPatheon\M'
       or pr.response_text ~* '\mFisher Scientific\M');

-- 2. Merge subsidiary canonicals into Thermo Fisher Scientific -------------
update public.entity_aliases
set canonical_id = '5338d2d0-0c36-45e6-a3f4-268542ca431d'
where canonical_id in ('6f7eadca-eeac-4265-8f7c-6ce9034fd493',
                       'b1e4ef01-08e5-432e-b9e3-402d700f49ad',
                       'f255cb27-52dc-4ecf-8785-cfd7dbfda1b4');

update public.entity_alias_suggestions
set resolved_canonical_id = '5338d2d0-0c36-45e6-a3f4-268542ca431d'
where resolved_canonical_id in ('6f7eadca-eeac-4265-8f7c-6ce9034fd493',
                                'b1e4ef01-08e5-432e-b9e3-402d700f49ad',
                                'f255cb27-52dc-4ecf-8785-cfd7dbfda1b4');

delete from public.canonical_entities ce
where ce.id in ('6f7eadca-eeac-4265-8f7c-6ce9034fd493',
                'b1e4ef01-08e5-432e-b9e3-402d700f49ad',
                'f255cb27-52dc-4ecf-8785-cfd7dbfda1b4')
  and not exists (select 1 from public.entity_aliases ea where ea.canonical_id = ce.id);

-- 3. Rebuild metrics for every company whose answers changed --------------
insert into public.company_metrics_dirty (company_id)
select distinct coalesce(pr.company_id, cp.company_id)
from public.prompt_responses pr
join public.confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
where coalesce(pr.company_id, cp.company_id) is not null
  and (   coalesce(pr.company_id, cp.company_id) = '74179bad-6411-44fc-9c89-e10868472924'
       or pr.canonical_competitors ~* '(^|,)\s*Thermo Fisher Scientific\s*(,|$)'
          and pr.detected_competitors ~* '\m(PPD|Patheon|Fisher Scientific)\M')
on conflict (company_id) do nothing;
