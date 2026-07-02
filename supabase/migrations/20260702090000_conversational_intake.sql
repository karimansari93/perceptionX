-- Conversational client intake: admin-created tokenized invites + structured brief submissions.
-- Client access is mediated exclusively by the SECURITY DEFINER functions below (token-gated);
-- the anon role has NO direct table access. Admins get full access via is_admin().

create table public.intake_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  company_name text not null,
  contact_email text not null,
  token text unique not null,
  status text not null default 'sent'
    check (status in ('sent','in_progress','submitted','reviewed','approved')),
  expires_at timestamptz not null default now() + interval '14 days',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.intake_invites(id) on delete cascade,
  payload jsonb not null,
  draft boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One submission per invite: makes draft upsert + resume trivial.
create unique index intake_submissions_invite_id_key on public.intake_submissions (invite_id);

alter table public.intake_invites enable row level security;
alter table public.intake_submissions enable row level security;

create policy intake_invites_admin_all on public.intake_invites
  for all using (is_admin()) with check (is_admin());
create policy intake_submissions_admin_all on public.intake_submissions
  for all using (is_admin()) with check (is_admin());

create or replace function public.intake_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger intake_submissions_touch
  before update on public.intake_submissions
  for each row execute function public.intake_touch_updated_at();

------------------------------------------------------------------------------
-- Admin: create an invite. company_name + contact_email are locked in here and
-- are read-only to the client for the life of the invite.
------------------------------------------------------------------------------
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

  -- 24 random bytes, url-safe base64 (no padding)
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');

  insert into public.intake_invites (company_name, contact_email, token, org_id, created_by)
  values (trim(p_company_name), lower(trim(p_contact_email)), v_token, p_org_id, auth.uid())
  returning * into v_invite;

  return v_invite;
end $$;

revoke execute on function public.create_intake_invite(text, text, uuid) from public, anon;
grant execute on function public.create_intake_invite(text, text, uuid) to authenticated;

------------------------------------------------------------------------------
-- Client: load invite + any saved draft by token. Marks the invite in_progress
-- on first open so the admin list reflects activity.
------------------------------------------------------------------------------
create or replace function public.intake_get_by_token(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.intake_invites;
  v_sub public.intake_submissions;
begin
  select * into v_invite from public.intake_invites where token = p_token;

  if v_invite.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_invite.expires_at < now() and v_invite.status in ('sent','in_progress') then
    return jsonb_build_object('error', 'expired');
  end if;

  if v_invite.status = 'sent' then
    update public.intake_invites set status = 'in_progress' where id = v_invite.id;
    v_invite.status := 'in_progress';
  end if;

  select * into v_sub from public.intake_submissions where invite_id = v_invite.id;

  return jsonb_build_object(
    'company_name', v_invite.company_name,
    'status', v_invite.status,
    'expires_at', v_invite.expires_at,
    'draft', case when v_sub.id is not null and v_sub.draft then v_sub.payload else null end,
    'submitted', v_sub.id is not null and not v_sub.draft
  );
end $$;

grant execute on function public.intake_get_by_token(text) to anon, authenticated;

------------------------------------------------------------------------------
-- Client: save draft progress (resumable). Only while the invite is open.
------------------------------------------------------------------------------
create or replace function public.intake_save_draft(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.intake_invites;
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

  if v_invite.status = 'sent' then
    update public.intake_invites set status = 'in_progress' where id = v_invite.id;
  end if;

  insert into public.intake_submissions (invite_id, payload, draft)
  values (v_invite.id, p_payload, true)
  on conflict (invite_id) do update
    set payload = excluded.payload
    where intake_submissions.draft = true;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.intake_save_draft(text, jsonb) to anon, authenticated;

------------------------------------------------------------------------------
-- Client: final submit. Validates required fields server-side, locks in the
-- invite-owned identity fields (client cannot override company/email), flips
-- the invite to submitted.
------------------------------------------------------------------------------
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
  if coalesce(trim(p_payload->>'focus_questions'), '') = '' then
    return jsonb_build_object('error', 'missing_focus_questions');
  end if;
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

------------------------------------------------------------------------------
-- Admin: approve a brief -> generate confirmed_prompts (idempotent).
-- The TS generator (generateConfirmedPrompts) produces deterministic rows keyed
-- by entity name; this function maps entity -> company (find-or-create), seeds
-- owned domains, stores report-framing context, and inserts prompts that do not
-- already exist for that company (dedupe on lower(prompt_text)), so approving
-- the same brief twice never duplicates rows.
------------------------------------------------------------------------------
create or replace function public.admin_approve_intake(
  p_invite_id uuid,
  p_rows jsonb,          -- [{entity_name, prompt_text, prompt_type, prompt_category, prompt_theme, job_function_context, location_context, industry_context}]
  p_brief jsonb,         -- report framing: leadership_objective, focus_questions, known_context, + full brief for reference
  p_owned_domains jsonb  -- [{entity_name, domain, asset_type, notes}]
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.intake_invites;
  v_entity text;
  v_company_id uuid;
  v_user_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_companies jsonb := '{}'::jsonb;
  v_row jsonb;
  v_dom jsonb;
  v_primary_name text;
begin
  if not is_admin() then
    raise exception 'admin only';
  end if;

  select * into v_invite from public.intake_invites where id = p_invite_id;
  if v_invite.id is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status not in ('submitted','reviewed','approved') then
    raise exception 'invite is not ready for approval (status: %)', v_invite.status;
  end if;

  v_primary_name := v_invite.company_name;

  -- best-effort user attribution for generated prompts (matches existing pipeline rows)
  if v_invite.org_id is not null then
    select om.user_id into v_user_id
    from organization_members om
    where om.organization_id = v_invite.org_id
    order by case om.role when 'owner' then 0 when 'admin' then 1 else 2 end, om.joined_at
    limit 1;
  end if;

  -- Find-or-create one company per distinct entity
  for v_entity in
    select distinct r->>'entity_name'
    from jsonb_array_elements(p_rows) r
  loop
    select id into v_company_id
    from companies
    where lower(name) = lower(v_entity)
    order by created_at
    limit 1;

    if v_company_id is null then
      insert into companies (name, industry, website, country, competitors, created_by)
      values (
        v_entity,
        nullif(p_brief->'industries'->>0, ''),
        nullif(trim(p_brief->>'career_site_url'), ''),
        nullif(p_brief->'markets'->>0, ''),
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(coalesce(p_brief->'talent_competitors','[]'::jsonb)) x),
          '{}'
        ),
        auth.uid()
      )
      returning id into v_company_id;
    end if;

    v_companies := v_companies || jsonb_build_object(v_entity, v_company_id);

    -- Report framing stored as strategy context, not prompt text
    update companies
    set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('intake_brief', p_brief),
        updated_at = now()
    where id = v_company_id;

    -- Link into the org if the invite is org-bound
    if v_invite.org_id is not null then
      insert into organization_companies (organization_id, company_id, added_by)
      select v_invite.org_id, v_company_id, auth.uid()
      where not exists (
        select 1 from organization_companies
        where organization_id = v_invite.org_id and company_id = v_company_id
      );
    end if;
  end loop;

  -- Owned-source seeds
  for v_dom in select * from jsonb_array_elements(coalesce(p_owned_domains, '[]'::jsonb))
  loop
    v_company_id := (v_companies->>(v_dom->>'entity_name'))::uuid;
    if v_company_id is not null and coalesce(trim(v_dom->>'domain'), '') <> '' then
      insert into company_owned_domains (company_id, domain, asset_type, notes)
      select v_company_id, lower(trim(v_dom->>'domain')), v_dom->>'asset_type', v_dom->>'notes'
      where not exists (
        select 1 from company_owned_domains
        where company_id = v_company_id and lower(domain) = lower(trim(v_dom->>'domain'))
      );
    end if;
  end loop;

  -- Prompt rows: insert only what does not already exist for the company
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_company_id := (v_companies->>(v_row->>'entity_name'))::uuid;
    if exists (
      select 1 from confirmed_prompts
      where company_id = v_company_id
        and lower(prompt_text) = lower(v_row->>'prompt_text')
    ) then
      v_skipped := v_skipped + 1;
    else
      insert into confirmed_prompts (
        company_id, prompt_text, prompt_type, prompt_category, prompt_theme,
        job_function_context, location_context, industry_context,
        is_active, created_by, user_id
      ) values (
        v_company_id,
        v_row->>'prompt_text',
        v_row->>'prompt_type',
        coalesce(v_row->>'prompt_category', 'General'),
        coalesce(v_row->>'prompt_theme', 'General'),
        v_row->>'job_function_context',
        v_row->>'location_context',
        v_row->>'industry_context',
        true,
        auth.uid(),
        v_user_id
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.intake_invites set status = 'approved' where id = p_invite_id;

  return jsonb_build_object(
    'ok', true,
    'companies', v_companies,
    'prompts_inserted', v_inserted,
    'prompts_skipped_existing', v_skipped
  );
end $$;

revoke execute on function public.admin_approve_intake(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.admin_approve_intake(uuid, jsonb, jsonb, jsonb) to authenticated;
