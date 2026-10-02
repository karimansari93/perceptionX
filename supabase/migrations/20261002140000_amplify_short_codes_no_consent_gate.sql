-- Amplify links get short codes (6 characters, e.g. https://csl.perceptionx.ai/k7m2qx)
-- and no longer wait on a recorded client consent.
--
-- Alphabet is lowercase letters and digits minus the look-alikes (0/o, 1/l/i),
-- so a code survives being read off a printed page: 31^6 is about 887 million
-- codes. That is enough here because a share host only serves its own client's
-- tokens and every miss is the same bare 404 (netlify/edge-functions/amplify-host.ts).
-- Bytes are drawn by rejection sampling (< 248 = 31 * 8) so no character is
-- favoured, and a code already in use is redrawn.
--
-- No consent gate. Links used to be refused until client consent was recorded
-- in activate_org_settings; we work with clients directly and the link is
-- theirs to share, so an admin can create one at any time. The consent columns
-- stay in place (nothing reads them now) so no recorded history is lost.
--
-- Restated from the LIVE definition otherwise unchanged: only the consent
-- check and the token line differ. Existing links keep their codes.

create or replace function public.admin_create_activate_link(
  p_org_id uuid,
  p_label text,
  p_audience text default null::text,
  p_prefill_market_code text default null::text,
  p_prefill_entity_company_id uuid default null::uuid,
  p_expires_days integer default null::integer
)
returns activate_links
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_link public.activate_links;
  v_token text;
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_byte int;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;
  if coalesce(trim(p_label), '') = '' then
    raise exception 'label is required';
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

  loop
    v_token := '';
    while length(v_token) < 6 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      if v_byte < 248 then
        v_token := v_token || substr(v_alphabet, (v_byte % 31) + 1, 1);
      end if;
    end loop;
    exit when not exists (select 1 from public.activate_links where token = v_token);
  end loop;

  insert into public.activate_links
    (org_id, token, label, audience, prefill_market_code, prefill_entity_company_id,
     created_by, expires_at)
  values
    (p_org_id, v_token, trim(p_label), p_audience, p_prefill_market_code,
     p_prefill_entity_company_id, auth.uid(),
     case when p_expires_days is null then null      else now() + make_interval(days => greatest(1, p_expires_days)) end)
  returning * into v_link;

  return v_link;
end $function$;
