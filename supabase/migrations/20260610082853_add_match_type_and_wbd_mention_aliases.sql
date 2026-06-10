-- Extend company_mention_aliases with a match_type so aliases can be matched as a
-- plain case-insensitive substring (good for distinctive transliterations like
-- 넷플릭스) OR as a case-insensitive POSIX regex (needed for brands whose mentions
-- are short/generic English tokens requiring word boundaries, or have several
-- spelling variants — e.g. Warner Bros Discovery: 워너 브라더스 / 워너브러더스 /
-- WarnerMedia / WBD / HBO / Discovery+).

alter table public.company_mention_aliases
  add column if not exists match_type text not null default 'substring';

alter table public.company_mention_aliases
  drop constraint if exists company_mention_aliases_match_type_chk;
alter table public.company_mention_aliases
  add constraint company_mention_aliases_match_type_chk
  check (match_type in ('substring','regex'));

-- Re-create the trigger function to honor match_type.
create or replace function public.apply_company_mention_aliases()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_name text;
begin
  if new.company_mentioned is true then
    return new;
  end if;
  if new.response_text is null or new.response_text = '' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.response_text is not distinct from old.response_text
     and new.company_mentioned is not distinct from old.company_mentioned then
    return new;
  end if;

  select c.name into v_company_name
  from public.companies c
  where c.id = coalesce(
    new.company_id,
    (select cp.company_id from public.confirmed_prompts cp where cp.id = new.confirmed_prompt_id)
  );

  if v_company_name is null then
    return new;  -- industry/no-company response: leave as-is
  end if;

  if exists (
    select 1
    from public.company_mention_aliases a
    where a.is_active
      and lower(a.company_name) = lower(v_company_name)
      and (
        (a.match_type = 'substring' and position(lower(a.alias) in lower(new.response_text)) > 0)
        or
        (a.match_type = 'regex' and new.response_text ~* a.alias)
      )
  ) then
    new.company_mentioned := true;
  end if;

  return new;
exception when others then
  return new;  -- never block a response write because of alias logic
end;
$$;

-- Seed Warner Bros Discovery aliases (regex; high-precision, multi-locale).
-- Deliberately EXCLUDES bare "Discovery"/"디스커버리" (also a Korean fashion brand and
-- a generic product term, e.g. "Search/Discovery"), bare "Max"/"맥스", and "TVN"
-- (tvN is a CJ ENM Korean channel, not WBD's Polish TVN) to avoid false positives.
insert into public.company_mention_aliases (company_name, alias, match_type, locale, notes) values
  ('Warner Bros Discovery', '워너\s?(브[라러]더스|미디어)', 'regex', 'ko',  'Korean Warner Bros / WarnerMedia (incl. 워너브러더스코리아, 워너브라더스디스커버리)'),
  ('Warner Bros Discovery', 'Warner Bro(s\.?|thers)',      'regex', null,  'Warner Bros / Warner Bros. / Warner Brothers'),
  ('Warner Bros Discovery', '\mWarnerMedia\M',             'regex', null,  'WarnerMedia (predecessor brand)'),
  ('Warner Bros Discovery', '\mWBD\M',                     'regex', null,  'WBD abbreviation'),
  ('Warner Bros Discovery', '\mHBO\M',                     'regex', null,  'HBO / HBO Max'),
  ('Warner Bros Discovery', 'Discovery\+',                 'regex', null,  'Discovery+ streaming service'),
  ('Warner Bros Discovery', '\mDiscovery Channel\M',       'regex', null,  'Discovery Channel'),
  ('Warner Bros Discovery', '\mDiscovery,\s?Inc',          'regex', null,  'Discovery, Inc')
on conflict (lower(company_name), lower(alias)) do nothing;
