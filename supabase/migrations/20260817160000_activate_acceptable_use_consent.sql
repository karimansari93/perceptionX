-- Activate: record what the client accepted, not just that someone ticked a box.
--
-- The consent gate already refused to mint links until an admin confirmed the
-- client had agreed. What it recorded was thin: a timestamp, a free-text note,
-- and consent_confirmed_by -> auth.users, which is *our* admin rather than
-- anyone at the client. So the record said "Karim ticked a box on the 11th",
-- not "this named person at CSL agreed to these terms". For a record whose only
-- job is to be worth something later, that is the wrong half.
--
-- Three changes:
--
--  1. A named client contact. The person at the client who actually agreed,
--     alongside (not instead of) the internal admin who recorded it.
--  2. A terms version. docs/ACTIVATE_ACCEPTABLE_USE.md is versioned in git;
--     the version shown at acceptance is stored here. Bumping the terms means
--     bumping ACTIVATE_CURRENT_TERMS below, at which point every org is back
--     behind the gate until they accept the new version. Consent to words a
--     client never saw is not consent.
--  3. Append-only history. Re-acceptance inserts a row rather than overwriting
--     the previous one, so "what did they agree to, and when" survives a later
--     change. activate_org_settings keeps the current-state columns so the gate
--     stays a single cheap lookup.

------------------------------------------------------------------------------
-- Current terms version
------------------------------------------------------------------------------

-- Bump this when docs/ACTIVATE_ACCEPTABLE_USE.md changes materially. Every org
-- then needs to re-accept before any further link is mintable. Kept as a
-- function rather than a constant so the gate and the UI read one source.
create or replace function public.activate_current_terms_version()
returns text language sql immutable as $$ select '2026-08-v1'::text $$;

grant execute on function public.activate_current_terms_version() to authenticated;

------------------------------------------------------------------------------
-- Append-only acceptance log
------------------------------------------------------------------------------

create table public.activate_consent_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Version of the acceptable-use terms the client was shown.
  terms_version text not null,
  -- The person at the CLIENT who agreed. Free text: they have no account here,
  -- and inventing one would be worse than writing their name down.
  client_contact_name text not null,
  client_contact_email text,
  -- The PerceptionX admin who recorded it. Audit of who entered the row, not
  -- of who agreed — those are different people and the old schema conflated them.
  recorded_by uuid references auth.users(id),
  note text,
  accepted_at timestamptz not null default now()
);

create index activate_consent_events_org_idx
  on public.activate_consent_events (org_id, accepted_at desc);

alter table public.activate_consent_events enable row level security;

-- Append-only: admins may read and insert, nobody may update or delete. The
-- value of this table is that it cannot be tidied up after the fact.
create policy activate_consent_events_admin_read on public.activate_consent_events
  for select using (is_admin());
create policy activate_consent_events_admin_insert on public.activate_consent_events
  for insert with check (is_admin());

------------------------------------------------------------------------------
-- Current state on the settings row (what the gate reads)
------------------------------------------------------------------------------

alter table public.activate_org_settings
  add column if not exists terms_version text,
  add column if not exists client_contact_name text,
  add column if not exists client_contact_email text;

comment on column public.activate_org_settings.consent_confirmed_by is
  'The PerceptionX admin who recorded the acceptance. The client-side person who
   actually agreed is client_contact_name.';

------------------------------------------------------------------------------
-- Record acceptance: one call writes the history row and the current state.
------------------------------------------------------------------------------

create or replace function public.admin_record_activate_consent(
  p_org_id uuid,
  p_client_contact_name text,
  p_client_contact_email text default null,
  p_note text default null,
  p_terms_version text default null
) returns public.activate_consent_events
language plpgsql security definer
set search_path = public
as $$
declare
  v_event public.activate_consent_events;
  v_version text := coalesce(nullif(trim(p_terms_version), ''),
                             public.activate_current_terms_version());
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  if coalesce(trim(p_client_contact_name), '') = '' then
    raise exception 'client_contact_required';
  end if;
  -- Recording acceptance of a version that isn't the current one would create a
  -- record that can never satisfy the gate, which is worse than refusing.
  if v_version <> public.activate_current_terms_version() then
    raise exception 'stale_terms_version';
  end if;

  insert into public.activate_consent_events
    (org_id, terms_version, client_contact_name, client_contact_email, recorded_by, note)
  values
    (p_org_id, v_version, trim(p_client_contact_name),
     nullif(trim(p_client_contact_email), ''), auth.uid(), nullif(trim(p_note), ''))
  returning * into v_event;

  insert into public.activate_org_settings as s
    (org_id, consent_confirmed_at, consent_confirmed_by, consent_note,
     terms_version, client_contact_name, client_contact_email)
  values
    (p_org_id, v_event.accepted_at, auth.uid(), v_event.note,
     v_event.terms_version, v_event.client_contact_name, v_event.client_contact_email)
  on conflict (org_id) do update set
    consent_confirmed_at = excluded.consent_confirmed_at,
    consent_confirmed_by = excluded.consent_confirmed_by,
    consent_note         = excluded.consent_note,
    terms_version        = excluded.terms_version,
    client_contact_name  = excluded.client_contact_name,
    client_contact_email = excluded.client_contact_email,
    updated_at           = now();

  return v_event;
end $$;

revoke execute on function public.admin_record_activate_consent(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.admin_record_activate_consent(uuid, text, text, text, text)
  to authenticated;

------------------------------------------------------------------------------
-- The gate: current terms, or no links.
------------------------------------------------------------------------------

create or replace function public.admin_create_activate_link(
  p_org_id uuid,
  p_label text,
  p_audience text default null,
  p_prefill_market_code text default null,
  p_prefill_entity_company_id uuid default null,
  p_expires_days int default 90
) returns public.activate_links
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_link public.activate_links;
  v_token text;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  if coalesce(trim(p_label), '') = '' then
    raise exception 'label is required';
  end if;
  -- Consent must exist AND be against the terms currently in force. An org that
  -- accepted an earlier version is back behind the gate until it re-accepts.
  if not exists (
    select 1 from public.activate_org_settings
    where org_id = p_org_id
      and consent_confirmed_at is not null
      and terms_version = public.activate_current_terms_version()
  ) then
    raise exception 'consent_required';
  end if;
  if p_audience is not null and p_audience not in ('employee', 'candidate', 'alumni') then
    raise exception 'invalid audience';
  end if;
  if p_prefill_market_code is not null and p_prefill_market_code !~ '^[A-Z]{2}$' then
    raise exception 'invalid market code';
  end if;
  if p_prefill_entity_company_id is not null and not exists (
    select 1 from public.organization_companies
    where organization_id = p_org_id and company_id = p_prefill_entity_company_id
  ) then
    raise exception 'entity does not belong to org';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');

  insert into public.activate_links
    (org_id, token, label, audience, prefill_market_code, prefill_entity_company_id,
     created_by, expires_at)
  values
    (p_org_id, v_token, trim(p_label), p_audience, p_prefill_market_code,
     p_prefill_entity_company_id, auth.uid(),
     now() + make_interval(days => greatest(1, coalesce(p_expires_days, 90))))
  returning * into v_link;

  return v_link;
end $$;

revoke execute on function public.admin_create_activate_link(uuid, text, text, text, uuid, int)
  from public, anon;
grant execute on function public.admin_create_activate_link(uuid, text, text, text, uuid, int)
  to authenticated;

------------------------------------------------------------------------------
-- Existing consent predates the terms entirely, so it does not carry over.
--
-- The three orgs currently marked consented agreed to a free-text note, not to
-- docs/ACTIVATE_ACCEPTABLE_USE.md — which did not exist. Backfilling them to
-- '2026-08-v1' would be the exact fiction this migration is meant to prevent,
-- so terms_version stays null and they sit behind the gate until someone walks
-- the client through the terms and records a named acceptance. That is the
-- intended cost of the change, not an oversight.
------------------------------------------------------------------------------
