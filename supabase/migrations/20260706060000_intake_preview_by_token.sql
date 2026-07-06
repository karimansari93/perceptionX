------------------------------------------------------------------------------
-- Read-only invite lookup for link-preview personalization.
--
-- The Netlify edge function that rewrites /onboarding/:token meta tags needs
-- the company name, but intake_get_by_token marks the invite in_progress on
-- first call — a social crawler fetching a preview would corrupt the admin
-- status. This variant returns only the company name and touches nothing.
------------------------------------------------------------------------------
create or replace function public.intake_preview_by_token(p_token text)
returns jsonb
language sql security definer stable
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('company_name', company_name)
       from public.intake_invites
      where token = p_token),
    jsonb_build_object('error', 'not_found')
  );
$$;

grant execute on function public.intake_preview_by_token(text) to anon, authenticated;
