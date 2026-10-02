-- Amplify (formerly Activate) private share hosts: https://<client>.perceptionx.ai/<token>.
--
-- link_subdomain names the client's share host. netlify/edge-functions/amplify-host.ts
-- serves a token on a share host only when the token's org has that subdomain,
-- so one client's link can never open under another client's name.
--
-- The host itself must also be added to the Netlify site's domains (and DNS)
-- by hand; setting the column alone only changes which link the admin copies.

alter table public.activate_branding
  add column if not exists link_subdomain text;

alter table public.activate_branding
  drop constraint if exists activate_branding_link_subdomain_format;
alter table public.activate_branding
  add constraint activate_branding_link_subdomain_format check (
    link_subdomain is null
    or (
      link_subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      -- Ours, never a client's. Keep in sync with RESERVED_SUBDOMAINS in
      -- netlify/lib/amplify-host.js and src/lib/activate/host.ts.
      and link_subdomain not in ('app', 'www', 'api', 'admin', 'mail', 'staging')
    )
  );

create unique index if not exists activate_branding_link_subdomain_key
  on public.activate_branding (link_subdomain)
  where link_subdomain is not null;

comment on column public.activate_branding.link_subdomain is
  'Private share host for this client''s Amplify links: csl -> https://csl.perceptionx.ai/<token>.';

-- Same function as 20260824130000, plus link_subdomain for the host check.
create or replace function public.activate_preview_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'display_name', coalesce(b.display_name, o.name),
        'tagline', b.tagline,
        'logo_url', coalesce(b.logo_url, o.logo_url),
        'logo_domain', b.logo_domain,
        'primary_color', coalesce(b.primary_color, '#13274F'),
        'accent_color', coalesce(b.accent_color, '#F59E0B'),
        'link_subdomain', b.link_subdomain
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

grant execute on function public.activate_preview_by_token(text) to anon, authenticated;

-- CSL is the first client on a share host.
update public.activate_branding
set link_subdomain = 'csl'
where org_id = 'ebbe52ed-0c8e-4d5b-9526-67496e09c6b4';
