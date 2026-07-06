-- Approval should leave the client fully collection-ready: if the invite is
-- not already linked to an organization, create one named after the company,
-- link every generated entity company to it, and store the brief on the org.
-- Starting a collection run for the org then needs no manual function/market
-- setup in the admin.

create or replace function public.admin_approve_intake(
  p_invite_id uuid,
  p_rows jsonb,          -- [{entity_name, prompt_text, prompt_type, prompt_category, prompt_theme, job_function_context, location_context, industry_context}]
  p_brief jsonb,         -- report framing + full brief for reference
  p_owned_domains jsonb  -- [{entity_name, domain, asset_type, notes}]
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite public.intake_invites;
  v_org_id uuid;
  v_entity text;
  v_company_id uuid;
  v_user_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_companies jsonb := '{}'::jsonb;
  v_row jsonb;
  v_dom jsonb;
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

  -- Find-or-create the organization. Idempotent across re-approvals: the org
  -- id is written back onto the invite the first time.
  if v_invite.org_id is not null then
    v_org_id := v_invite.org_id;
  else
    select id into v_org_id
    from organizations
    where lower(name) = lower(v_invite.company_name)
    order by created_at
    limit 1;

    if v_org_id is null then
      insert into organizations (name, description, created_by)
      values (
        v_invite.company_name,
        'Created from the onboarding brief',
        auth.uid()
      )
      returning id into v_org_id;
    end if;

    update public.intake_invites set org_id = v_org_id where id = p_invite_id;
  end if;

  -- Strategy context lives on the org as well as the companies.
  update organizations
  set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('intake_brief', p_brief),
      updated_at = now()
  where id = v_org_id;

  -- best-effort user attribution for generated prompts (matches existing pipeline rows)
  select om.user_id into v_user_id
  from organization_members om
  where om.organization_id = v_org_id
  order by case om.role when 'owner' then 0 when 'admin' then 1 else 2 end, om.joined_at
  limit 1;

  -- Find-or-create one company per distinct entity, linked into the org
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

    update companies
    set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('intake_brief', p_brief),
        updated_at = now()
    where id = v_company_id;

    insert into organization_companies (organization_id, company_id, added_by)
    select v_org_id, v_company_id, auth.uid()
    where not exists (
      select 1 from organization_companies
      where organization_id = v_org_id and company_id = v_company_id
    );
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
    'org_id', v_org_id,
    'companies', v_companies,
    'prompts_inserted', v_inserted,
    'prompts_skipped_existing', v_skipped
  );
end $$;

revoke execute on function public.admin_approve_intake(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.admin_approve_intake(uuid, jsonb, jsonb, jsonb) to authenticated;
