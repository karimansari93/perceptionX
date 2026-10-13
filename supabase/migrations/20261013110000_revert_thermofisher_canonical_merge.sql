-- Revert step 2 of 20261013100000_thermofisher_subsidiary_aliases.
--
-- That migration merged the PPD, Patheon and Fisher Scientific canonicals
-- into Thermo Fisher Scientific. canonical_entities feeds the public Index
-- and every client, so subsidiary roll-ups belong in a report-level parent
-- table instead (entity_parent_groups, separate migration). The mention
-- aliases and company_mentioned backfill from that migration stay.
--
-- Restores the three canonicals with their original ids, moves the six
-- aliases and six suggestions back. trg_entity_aliases_recanon_upd then
-- recomputes canonical_competitors for rows whose detected_competitors
-- contain an alias term (ILIKE, so it over-matches; recompute is
-- idempotent). Dry run 2026-10-13: 808 rows recomputed, 353 change value
-- (Thermo Fisher Scientific 338, CSL Seqirus 7, CSL Behring 6,
-- Al Kabeer Food 2).

-- 0. Back up the rows the recompute will touch ----------------------------
create table if not exists public.backup_20261013_canon_revert as
select pr.id, pr.detected_competitors, pr.canonical_competitors, pr.canonicalized_at
from public.prompt_responses pr
where pr.detected_competitors is not null
  and exists (
      select 1
      from unnest(array['PPD','PPD Clinical Research Services','PPD Germany',
                        'PPD Clinical Research','Patheon','Fisher Scientific']) t(term)
      where pr.detected_competitors ilike '%' || public.escape_like(t.term) || '%');

alter table public.backup_20261013_canon_revert enable row level security;

-- 1. Recreate the canonicals with their original ids ----------------------
-- The self-alias trigger tries to insert 'ppd' / 'patheon' /
-- 'fisher scientific' and hits ON CONFLICT DO NOTHING, since those aliases
-- still exist on Thermo until step 2 moves them.
insert into public.canonical_entities (id, canonical_name, normalized_name, entity_type, is_active, created_at)
values
  ('6f7eadca-eeac-4265-8f7c-6ce9034fd493', 'PPD',               'ppd',               'other', true, '2026-09-25 14:50:00.254488+00'),
  ('b1e4ef01-08e5-432e-b9e3-402d700f49ad', 'Patheon',           'patheon',           'other', true, '2026-09-25 14:30:00.142733+00'),
  ('f255cb27-52dc-4ecf-8785-cfd7dbfda1b4', 'Fisher Scientific', 'fisher scientific', 'other', true, '2026-09-30 14:15:00.242592+00');

-- 2. Move the six aliases back --------------------------------------------
update public.entity_aliases ea
set canonical_id = v.canonical_id::uuid
from (values
  ('f75d146f-52db-469e-81ff-cf48378ab4dc', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),  -- PPD
  ('67c96f1c-a840-4d7d-a3d1-bd871f47b5c1', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),  -- PPD Clinical Research Services
  ('9add5530-8e1e-4526-bb87-e47b7d6e306c', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),  -- PPD Germany
  ('c8a77c6a-1587-4777-a1f2-75916e2b3be0', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),  -- PPD Clinical Research
  ('54a5d53d-72ff-48a8-905a-da6bd8860cc5', 'b1e4ef01-08e5-432e-b9e3-402d700f49ad'),  -- Patheon
  ('06f9ad56-9b42-434b-9ef4-002e94fd3a8b', 'f255cb27-52dc-4ecf-8785-cfd7dbfda1b4')   -- Fisher Scientific
) v(alias_id, canonical_id)
where ea.id = v.alias_id::uuid;

-- 3. Repoint the six suggestions ------------------------------------------
update public.entity_alias_suggestions s
set resolved_canonical_id = v.canonical_id::uuid
from (values
  ('b048490f-ef72-4406-805f-79fcc5f253f2', 'b1e4ef01-08e5-432e-b9e3-402d700f49ad'),
  ('65228858-8547-4671-8911-7a9071074f2a', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),
  ('b4ff0b1c-12e5-4e9a-8ea9-e3c75d27bcd0', 'f255cb27-52dc-4ecf-8785-cfd7dbfda1b4'),
  ('d59d091f-fa0d-408e-bbfe-88deaed1789a', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),
  ('2dbf9228-356a-410b-a78d-b94dbfd630b3', '6f7eadca-eeac-4265-8f7c-6ce9034fd493'),
  ('4d37dc2e-9717-46bc-a5a7-18cf264472e4', '6f7eadca-eeac-4265-8f7c-6ce9034fd493')
) v(suggestion_id, canonical_id)
where s.id = v.suggestion_id::uuid;

-- 4. Queue metrics rebuilds -----------------------------------------------
insert into public.company_metrics_dirty (company_id) values
  ('74179bad-6411-44fc-9c89-e10868472924')
on conflict (company_id) do nothing;

insert into public.company_metrics_dirty (company_id)
select distinct coalesce(pr.company_id, cp.company_id)
from public.backup_20261013_canon_revert b
join public.prompt_responses pr on pr.id = b.id
join public.confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
where coalesce(pr.company_id, cp.company_id) is not null
on conflict (company_id) do nothing;
