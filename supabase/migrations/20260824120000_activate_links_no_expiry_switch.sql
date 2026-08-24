-- Activate links stay live until someone turns them off.
--
-- Expiry was a 90-day timer stamped at mint time. A cohort link that a client
-- had put in an onboarding pack, an email footer or a poster went quietly dead
-- on a date nobody was tracking, and the only repair was minting a new link
-- with a new token — every copy of the old one already in the wild stayed dead.
--
-- The control senders actually want is a switch, and revoked_at is already
-- that switch; it just never had a way back. So:
--   expires_at  -> optional. Null (the new default) means the link never expires.
--   revoked_at  -> the on/off state, reversible by clearing it.
--
-- expires_at is kept rather than dropped: a genuinely time-boxed campaign link
-- is still worth being able to mint, and admin_create_activate_link still
-- honours p_expires_days when it is passed one.

alter table public.activate_links
  alter column expires_at drop not null,
  alter column expires_at drop default;

comment on column public.activate_links.expires_at is
  'Optional hard stop. Null (the default) = never expires. To take a link out '
  'of service, set revoked_at instead — that switch is reversible.';
comment on column public.activate_links.revoked_at is
  'Off switch. Set = the page answers with the friendly dead-end; cleared = live again.';

-- Existing links lose their timers, the already-expired ones included: the
-- point of the change is that a link a client is still handing out keeps
-- working. Anything that should be dead gets turned off explicitly.
update public.activate_links set expires_at = null where expires_at is not null;

------------------------------------------------------------------------------
-- The two token RPCs and the minter, rewritten in place.
--
-- Their bodies in production sit several revisions ahead of this repo (uniform
-- token errors, acceptable-use consent, the p_channels overload — all applied
-- via MCP without the body being restated here). Restating them from this file
-- would silently roll those revisions back, so instead the two expiry
-- expressions are rewritten on whatever body is installed. Both rewrites are
-- exact-string and idempotent; a body that has neither (this repo's own
-- 20260811160000 form, which tests expiry with a null-safe `if`) is left alone.
------------------------------------------------------------------------------

do $patch$
declare
  r record;
  v_new text;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('activate_get_by_token', 'activate_log_event',
                        'admin_create_activate_link')
  loop
    v_new := r.def;

    -- Recipient lookups filter on `expires_at > now()`, which drops a
    -- never-expiring link (null > now() is null) as surely as an expired one.
    v_new := replace(
      v_new,
      'revoked_at is null and expires_at > now()',
      'revoked_at is null and (expires_at is null or expires_at > now())');

    -- Minting: no p_expires_days now means no expiry, rather than 90 days.
    v_new := replace(
      v_new,
      'now() + make_interval(days => greatest(1, coalesce(p_expires_days, 90)))',
      'case when p_expires_days is null then null'
      '      else now() + make_interval(days => greatest(1, p_expires_days)) end');
    v_new := replace(
      v_new,
      'p_expires_days integer DEFAULT 90',
      'p_expires_days integer DEFAULT NULL::integer');

    if v_new <> r.def then
      execute v_new;
    end if;
  end loop;

  -- A rewrite that quietly missed would leave links expiring with no sign of
  -- it until the first one died, so assert the old shapes are gone.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('activate_get_by_token', 'activate_log_event',
                        'admin_create_activate_link')
      and (pg_get_functiondef(p.oid) like '%coalesce(p_expires_days, 90)%'
        or pg_get_functiondef(p.oid) like '%and expires_at > now()%')
  ) then
    raise exception 'activate expiry rewrite missed a function body — inspect the drifted definition';
  end if;
end $patch$;
