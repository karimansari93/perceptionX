-- Localized / transliterated company-name aliases used to detect company mentions
-- in non-Latin-script AI responses (e.g. Korean "넷플릭스" = "Netflix").
--
-- Background: company_mentioned was computed by a literal substring match of the
-- English company name against response_text (analyze-response edge function).
-- For Korean (and other) prompts the models answer using the transliterated brand
-- name, so the English name never appears and company_mentioned was wrongly stored
-- as false. This had been corrected by hand every month (see the earlier one-off
-- 20260427125941_fix_wbd_company_mentioned_backfill). This table + trigger make the
-- correction automatic for every write path that inserts into prompt_responses.

create table if not exists public.company_mention_aliases (
  id           uuid primary key default gen_random_uuid(),
  company_name text not null,              -- canonical brand name, matched against companies.name (case-insensitive)
  alias        text not null,              -- string to look for in response_text (e.g. 넷플릭스)
  locale       text,                       -- optional, informational (e.g. 'ko')
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.company_mention_aliases is
  'Localized/transliterated brand-name aliases for detecting company mentions in non-Latin AI responses. Drives the apply_company_mention_aliases() trigger on prompt_responses and the matching backfill.';

create unique index if not exists company_mention_aliases_name_alias_key
  on public.company_mention_aliases (lower(company_name), lower(alias));

create index if not exists company_mention_aliases_active_name_idx
  on public.company_mention_aliases (lower(company_name)) where is_active;

alter table public.company_mention_aliases enable row level security;

drop policy if exists company_mention_aliases_read on public.company_mention_aliases;
create policy company_mention_aliases_read
  on public.company_mention_aliases for select to authenticated using (true);

drop trigger if exists update_company_mention_aliases_updated_at on public.company_mention_aliases;
create trigger update_company_mention_aliases_updated_at
  before update on public.company_mention_aliases
  for each row execute function public.update_updated_at_column();

-- Seed the known-affected Korean transliterations (South Korea coverage).
insert into public.company_mention_aliases (company_name, alias, locale, notes) values
  ('Netflix', '넷플릭스',   'ko', 'Korean transliteration of Netflix'),
  ('Spotify', '스포티파이', 'ko', 'Korean transliteration of Spotify')
on conflict (lower(company_name), lower(alias)) do nothing;

-- Upgrade company_mentioned false -> true when a known alias for the response's
-- company appears in response_text. Only ever sets true (never false) and is
-- wrapped so it can never break a prompt_responses insert/update.
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
      and position(lower(a.alias) in lower(new.response_text)) > 0
  ) then
    new.company_mentioned := true;
  end if;

  return new;
exception when others then
  return new;  -- never block a response write because of alias logic
end;
$$;

drop trigger if exists trg_apply_company_mention_aliases on public.prompt_responses;
create trigger trg_apply_company_mention_aliases
  before insert or update on public.prompt_responses
  for each row execute function public.apply_company_mention_aliases();
