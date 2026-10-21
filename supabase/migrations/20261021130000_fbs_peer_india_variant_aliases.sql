-- Competitor name variants: India entities and sub-units of the tech and GCC
-- peers Ford Business Solutions India asked about (Karim, 2026-10-21).
--
-- canonicalize_competitor_list() left these as separate entities, splitting
-- each parent's count. Aliases are global: each is the same employer for
-- every client. All 17 were unmapped and every parent canonical exists.
--
-- Deliberately not merged: MBRDI (stays apart from Mercedes-Benz) and
-- Renault-Nissan (apart from Nissan), the R&D and tech centres FBS named;
-- plain Alphabet (its own canonical); Walmart Labs and the Mahindra variants
-- (not in scope).

-- 0. Back up every row the alias triggers will recompute ------------------
create table if not exists public.backup_20261021_fbs_peer_aliases as
select pr.id, pr.detected_competitors, pr.canonical_competitors, pr.canonicalized_at
from public.prompt_responses pr
where pr.detected_competitors is not null
  and exists (
      select 1
      from unnest(array[
          'Amazon / AWS India','Amazon India / AWS','Google India / Alphabet',
          'Alphabet/Google India','Google India / Google','JPMorganChase India',
          'JPMorgan Chase India Tech','Oracle Cloud ERP','Oracle ERP/Cloud',
          'Oracle India / NetSuite','TCS Analytics & Insights',
          'TCS Enterprise Solutions','TCS iON BizHub','Cognizant India',
          'Accenture Solutions Pvt Ltd','Cisco Systems India Private Limited']) t(term)
      where pr.detected_competitors ilike '%' || public.escape_like(t.term) || '%');

alter table public.backup_20261021_fbs_peer_aliases enable row level security;

-- 1. Aliases onto the existing parents -------------------------------------
insert into public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
select ce.id, v.alias, public.normalize_entity_name(v.alias), 'admin_manual', now()
from (values
  ('Amazon',         'Amazon / AWS India'),
  ('Amazon',         'Amazon India / AWS'),
  ('Amazon',         'Amazon India / AWS India'),
  ('Google',         'Google India / Alphabet'),
  ('Google',         'Alphabet/Google India'),
  ('Google',         'Google India / Google'),
  ('JPMorgan Chase', 'JPMorganChase India'),
  ('JPMorgan Chase', 'JPMorgan Chase India Tech'),
  ('Oracle',         'Oracle Cloud ERP'),
  ('Oracle',         'Oracle ERP/Cloud'),
  ('Oracle',         'Oracle India / NetSuite'),
  ('TCS',            'TCS Analytics & Insights'),
  ('TCS',            'TCS Enterprise Solutions'),
  ('TCS',            'TCS iON BizHub'),
  ('Cognizant',      'Cognizant India'),
  ('Accenture',      'Accenture Solutions Pvt Ltd'),
  ('Cisco',          'Cisco Systems India Private Limited')
) v(canonical_name, alias)
join public.canonical_entities ce on ce.canonical_name = v.canonical_name
on conflict (normalized_alias) do nothing;

-- 2. Close pending suggestions these aliases now cover ---------------------
update public.entity_alias_suggestions s
set status = 'approved',
    resolved_canonical_id = ea.canonical_id,
    resolved_at = now()
from public.entity_aliases ea
join public.canonical_entities ce on ce.id = ea.canonical_id
where ea.normalized_alias = s.normalized_alias
  and s.status = 'pending'
  and ce.canonical_name in ('Amazon','Google','JPMorgan Chase','Oracle','TCS',
        'Cognizant','Accenture','Cisco');

-- 3. Queue metrics rebuilds -----------------------------------------------
insert into public.company_metrics_dirty (company_id)
select distinct coalesce(pr.company_id, cp.company_id)
from public.backup_20261021_fbs_peer_aliases b
join public.prompt_responses pr on pr.id = b.id
join public.confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
where coalesce(pr.company_id, cp.company_id) is not null
on conflict (company_id) do nothing;
