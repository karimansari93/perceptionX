-- Shorter onboarding links: tokens go from 32 chars to 8 url-safe chars
-- (6 random bytes → exactly 8 base64url chars, 48 bits). A retry loop guards
-- against the rare unique-index collision. Existing tokens are untouched.
create or replace function public.create_intake_invite(
  p_company_name text,
  p_contact_email text,
  p_org_id uuid default null
) returns public.intake_invites
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_invite public.intake_invites;
  v_token text;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  if coalesce(trim(p_company_name), '') = '' or coalesce(trim(p_contact_email), '') = '' then
    raise exception 'company name and contact email are required';
  end if;

  -- 6 random bytes → exactly 8 url-safe base64 chars. Retry on collision.
  loop
    v_token := translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/', '-_');
    exit when not exists (select 1 from public.intake_invites where token = v_token);
  end loop;

  insert into public.intake_invites (company_name, contact_email, token, org_id, created_by)
  values (trim(p_company_name), lower(trim(p_contact_email)), v_token, p_org_id, auth.uid())
  returning * into v_invite;

  return v_invite;
end $$;

revoke execute on function public.create_intake_invite(text, text, uuid) from public, anon;
grant execute on function public.create_intake_invite(text, text, uuid) to authenticated;
