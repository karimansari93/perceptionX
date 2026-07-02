-- Focus questions became optional (client can skip). Relax the server-side
-- required-field gate in intake_submit to match; identity-locking and the
-- other required fields are unchanged.

create or replace function public.intake_submit(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.intake_invites;
  v_payload jsonb;
  v_primary_count int;
begin
  select * into v_invite from public.intake_invites where token = p_token;

  if v_invite.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_invite.expires_at < now() and v_invite.status in ('sent','in_progress') then
    return jsonb_build_object('error', 'expired');
  end if;
  if v_invite.status not in ('sent','in_progress') then
    return jsonb_build_object('error', 'already_submitted');
  end if;
  if pg_column_size(p_payload) > 200000 then
    return jsonb_build_object('error', 'payload_too_large');
  end if;

  -- Required-field gating (mirror of client-side validation, enforced here)
  if jsonb_typeof(p_payload->'job_functions') is distinct from 'array'
     or jsonb_array_length(p_payload->'job_functions') < 1 then
    return jsonb_build_object('error', 'missing_job_functions');
  end if;
  if jsonb_typeof(p_payload->'markets') is distinct from 'array'
     or jsonb_array_length(p_payload->'markets') < 1 then
    return jsonb_build_object('error', 'missing_markets');
  end if;
  if coalesce(trim(p_payload->>'career_site_url'), '') = '' then
    return jsonb_build_object('error', 'missing_career_site_url');
  end if;
  -- focus_questions is now optional.
  select count(*) into v_primary_count
  from jsonb_array_elements(coalesce(p_payload->'report_recipients', '[]'::jsonb)) r
  where (r->>'is_primary')::boolean is true;
  if v_primary_count is distinct from 1 then
    return jsonb_build_object('error', 'need_exactly_one_primary_recipient');
  end if;

  -- Identity fields come from the invite, never from the client.
  v_payload := p_payload
    || jsonb_build_object(
      'company_name', v_invite.company_name,
      'contact_email', v_invite.contact_email,
      'meta', jsonb_build_object(
        'invite_token', v_invite.token,
        'completed_at', now()
      )
    );

  insert into public.intake_submissions (invite_id, payload, draft, completed_at)
  values (v_invite.id, v_payload, false, now())
  on conflict (invite_id) do update
    set payload = excluded.payload,
        draft = false,
        completed_at = now()
    where intake_submissions.draft = true;

  update public.intake_invites set status = 'submitted' where id = v_invite.id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.intake_submit(text, jsonb) to anon, authenticated;
