------------------------------------------------------------------------------
-- Read-only branding lookup for Activate link previews.
--
-- The Netlify edge functions that personalise /activate/:token meta tags and
-- draw its share card both run for social crawlers, and both need the client's
-- name and colours. activate_get_by_token is the wrong door for that: it stamps
-- an 'open' event, so every WhatsApp, Slack and LinkedIn unfurl of a link would
-- register as somebody opening it and put phantom opens at the top of the
-- funnel in the admin. This variant returns branding only and writes nothing.
--
-- Same shape as intake_preview_by_token, which exists for the same reason on
-- the onboarding side.
--
-- A link that is switched off gets no branding: the page behind it is the
-- friendly dead-end, and its preview should not still be advertising the
-- client. Callers treat null branding as "use the unbranded preview", which is
-- also what they do when this function is unreachable.
------------------------------------------------------------------------------

create or replace function public.activate_preview_by_token(p_token text)
returns jsonb
language sql security definer stable
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'display_name', coalesce(b.display_name, o.name),
        -- The client's own line, for the share card's eyebrow.
        'tagline', b.tagline,
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
  'Branding for a live Activate link, for link-preview rendering. Read-only on '
  'purpose — never use activate_get_by_token for a crawler, it logs an open.';

grant execute on function public.activate_preview_by_token(text) to anon, authenticated;
