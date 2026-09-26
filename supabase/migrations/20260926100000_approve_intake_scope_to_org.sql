-- Brief approval must never attach another client's org or company.
--
-- admin_approve_intake matched the organization and each company by name
-- across the whole platform. A brief listing "Microsoft" would link the
-- existing Microsoft company from another client's org into the new org,
-- overwrite its intake_brief and add prompts to it, and a brief whose company
-- name matched another org's name was approved into that org.
--
-- Now: the org is the invite's org_id (set when the invite is created from an
-- org), else a new org. Companies are matched by name only among the org's
-- own companies; otherwise a new company is created. Re-approvals stay
-- idempotent because the org id is written back onto the invite.
DO $$
DECLARE
  v_def text;
  v_old_org text := $old$    select id into v_org_id
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
    end if;$old$;
  v_new_org text := $new$    insert into organizations (name, created_by)
    values (v_invite.company_name, auth.uid())
    returning id into v_org_id;$new$;
  v_old_co text := $old$    select id into v_company_id
    from companies
    where lower(name) = lower(v_entity)
    order by created_at
    limit 1;$old$;
  v_new_co text := $new$    v_company_id := null;
    select c.id into v_company_id
    from companies c
    join organization_companies oc on oc.company_id = c.id
    where oc.organization_id = v_org_id
      and lower(c.name) = lower(v_entity)
    order by c.created_at
    limit 1;$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_approve_intake';

  IF strpos(v_def, v_old_org) = 0 OR strpos(v_def, v_old_co) = 0 THEN
    RAISE EXCEPTION 'admin_approve_intake no longer matches the expected body; update this migration';
  END IF;

  v_def := replace(v_def, v_old_org, v_new_org);
  v_def := replace(v_def, v_old_co, v_new_co);
  EXECUTE v_def;
END $$;
