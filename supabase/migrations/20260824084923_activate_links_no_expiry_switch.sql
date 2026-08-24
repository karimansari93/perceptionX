-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260824084923; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Activate links stay live until someone turns them off. Expiry becomes
-- optional (null = never expires, the new default) and revoked_at becomes the
-- reversible on/off switch. See
-- supabase/migrations/20260824120000_activate_links_no_expiry_switch.sql.

alter table public.activate_links
  alter column expires_at drop not null,
  alter column expires_at drop default;

comment on column public.activate_links.expires_at is
  'Optional hard stop. Null (the default) = never expires. To take a link out '
  'of service, set revoked_at instead — that switch is reversible.';
comment on column public.activate_links.revoked_at is
  'Off switch. Set = the page answers with the friendly dead-end; cleared = live again.';

update public.activate_links set expires_at = null where expires_at is not null;

-- The token RPCs and the minter are rewritten in place rather than restated:
-- their production bodies sit ahead of the repo (uniform token errors,
-- acceptable-use consent, the p_channels overload), and restating would roll
-- those back. Both rewrites are exact-string and idempotent.
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
