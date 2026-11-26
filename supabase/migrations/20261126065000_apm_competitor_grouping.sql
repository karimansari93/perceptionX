-- APM demo (2026-11-26, asked by Karim): clean APM's competitor list.
-- Scope: APM's own answers only (company 229b40e5-...). canonical_competitors
-- is derived; detected_competitors is left untouched, so a re-canonicalization
-- restores the original values (that is the backup).
--
-- 1. Remove APM's own brands (ChatGPT's answers themselves name these as APM
--    Group brands): APM, APM Group, APM Human Services International, APM
--    WorkCare, WorkCare, Lifecare, Konekt, Acumen Health, Early Start
--    Australia, Biosymm, Therapy Focus, Interact Injury Management.
-- 2. Group MedHealth brands under MedHealth (answers name atWork Australia,
--    IPAR and WorkFocus Australia as MedHealth businesses).
-- 3. Merge spelling variants: Altius / Altius Group; Framework Search and/&
--    Select Health.
-- Follow-up: do the same through entity_aliases so new answers follow.

update public.prompt_responses pr
set canonical_competitors = coalesce((
  select string_agg(distinct m, ', ' order by m)
  from (
    select case
      when lower(x) in ('medhealth','atwork australia','ipar','workfocus australia','workfocus') then 'MedHealth'
      when lower(x) in ('altius','altius group') then 'Altius Group'
      when lower(x) in ('framework search and select health','framework search & select health') then 'Framework Search & Select Health'
      else x end m
    from unnest(string_to_array(pr.canonical_competitors, ',')) u(raw)
    cross join lateral (select btrim(raw) x) y
    where x <> ''
      and lower(x) not in ('apm','apm group','apm human services international','apm workcare','workcare',
                           'lifecare','konekt','acumen health','early start australia','biosymm',
                           'therapy focus','interact injury management')
  ) z
), '')
where pr.company_id = '229b40e5-812c-4d4f-af39-7254f137ac66'
  and pr.canonical_competitors is not null;

-- Same cleanup on detected_competitors (the competitor tab reads this column).
-- Backup of the original values: docs/backups/apm_detected_competitors_2026-11-26.json
update public.prompt_responses pr
set detected_competitors = coalesce((
  select string_agg(distinct m, ', ' order by m)
  from (
    select case
      when lower(x) in ('medhealth','atwork australia','ipar','workfocus australia','workfocus') then 'MedHealth'
      when lower(x) in ('altius','altius group') then 'Altius Group'
      when lower(x) in ('framework search and select health','framework search & select health') then 'Framework Search & Select Health'
      else x end m
    from unnest(string_to_array(pr.detected_competitors, ',')) u(raw)
    cross join lateral (select btrim(raw) x) y
    where x <> ''
      and lower(x) not in ('apm','apm group','apm human services international','apm workcare','workcare',
                           'lifecare','konekt','acumen health','early start australia','biosymm',
                           'therapy focus','interact injury management')
  ) z
), '')
where pr.company_id = '229b40e5-812c-4d4f-af39-7254f137ac66'
  and coalesce(pr.detected_competitors,'') <> '';
