-- More names that count as a Ford Business Solutions mention (Karim,
-- 2026-10-22).
--
-- analyze-response only matches "Ford Business Solutions" (plus the existing
-- \mFBS\M alias). AI also calls FBS "Ford India", e.g. listing it among
-- India's analytics capability centres, and answers to questions about FBS
-- describe it as "Ford India". "Ford Global Business Services" / "Ford GBS"
-- are former names: no answer uses them yet, added so they never slip.
-- Bare "Ford" is deliberately not an alias: it also means the carmaker.
--
-- The trigger only re-checks a row when response_text or company_mentioned
-- changes, so existing rows are flipped here with the same match.
-- Dry run 2026-10-22: 5 FBS answers flip: 1 discovery (2026-10-21, GCC
-- framing), 2 experience (2026-10-03), 1 experience and 1 informational
-- (2026-07-14).

-- 0. Back up the rows this flips ---------------------------------------------
create table if not exists public.backup_20261022_fbs_mention_aliases as
select pr.id, pr.company_mentioned, pr.updated_at
from public.prompt_responses pr
left join public.confirmed_prompts cp on cp.id = pr.confirmed_prompt_id
where coalesce(pr.company_id, cp.company_id) = '6013cdc4-5936-4436-86fe-852382469f94'
  and pr.company_mentioned is not true
  and pr.response_text ~* '(\mFord India\M|\mFord Global Business Services\M|\mFord GBS\M)';

alter table public.backup_20261022_fbs_mention_aliases enable row level security;

-- 1. Aliases -----------------------------------------------------------------
insert into public.company_mention_aliases (company_name, alias, match_type, is_active, notes)
values
  ('Ford Business Solutions', '\mFord India\M', 'regex', true,
   'What AI often calls FBS (its India tech and business centre)'),
  ('Ford Business Solutions', '\mFord Global Business Services\M', 'regex', true,
   'Former name of FBS'),
  ('Ford Business Solutions', '\mFord GBS\M', 'regex', true,
   'Former name of FBS, abbreviated');

-- 2. Re-evaluate existing answers ----------------------------------------------
update public.prompt_responses pr
set company_mentioned = true
from public.backup_20261022_fbs_mention_aliases b
where pr.id = b.id;

-- 3. Queue metrics rebuild -----------------------------------------------------
insert into public.company_metrics_dirty (company_id)
values ('6013cdc4-5936-4436-86fe-852382469f94')
on conflict (company_id) do nothing;
