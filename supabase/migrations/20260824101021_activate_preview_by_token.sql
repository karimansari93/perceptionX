-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260824101021; this file was
-- back-filled afterwards and therefore post-dates the deployment.

create or replace function public.activate_preview_by_token(p_token text)
returns jsonb
language sql security definer stable
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'display_name', coalesce(b.display_name, o.name),
        'logo_url', coalesce(b.logo_url, o.logo_url),
        'logo_domain', b.logo_domain,
        'primary_color', coalesce(b.primary_color, '#13274F'),
        'accent_color', coalesce(b.accent_color, '#F59E0B')
      )
      from public.activate_links l
      join public.organizations o on o.id = l.org_id
      left join public.activate_branding b on b.org_id = l.org_id
      where l.token = p_token
        and l.revoked_at is null
        and (l.expires_at is null or l.expires_at > now())
    ),
    jsonb_build_object('error', 'not_found')
  );
$$;

comment on function public.activate_preview_by_token(text) is
  'Branding for a live Activate link, for link-preview rendering. Read-only on purpose — never use activate_get_by_token for a crawler, it logs an open.';

grant execute on function public.activate_preview_by_token(text) to anon, authenticated;
