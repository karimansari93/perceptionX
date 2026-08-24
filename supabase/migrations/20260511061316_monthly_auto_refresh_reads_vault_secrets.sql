-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260511061316; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE OR REPLACE FUNCTION public.monthly_auto_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_current_month TEXT := to_char(NOW(), 'YYYY-MM');
    v_org RECORD;
    v_owner_id uuid;
    v_config_id uuid;
    v_jobs_created int;
    v_orgs_refreshed int := 0;
    v_total_jobs int := 0;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    FOR v_org IN
        SELECT id, name
        FROM public.organizations
        WHERE auto_refresh_enabled = true
    LOOP
        SELECT om.user_id
        INTO v_owner_id
        FROM public.organization_members om
        WHERE om.organization_id = v_org.id
          AND om.role = 'owner'
        ORDER BY COALESCE(om.is_default, false) DESC, om.created_at ASC
        LIMIT 1;

        IF v_owner_id IS NULL THEN
            CONTINUE;
        END IF;

        INSERT INTO public.company_batch_configs (
            user_id, company_name, org_mode, organization_id,
            target_locations, target_industries, target_job_functions,
            skip_if_collected_in_month
        ) VALUES (
            v_owner_id,
            v_org.name || ' monthly refresh ' || v_current_month,
            'existing_org',
            v_org.id,
            '{}', '{}', '{}',
            v_current_month
        )
        RETURNING id INTO v_config_id;

        WITH org_companies AS (
            SELECT company_id
            FROM public.organization_companies
            WHERE organization_id = v_org.id
        ),
        combos AS (
            SELECT DISTINCT
                cp.company_id,
                c.name AS company_name,
                COALESCE(cp.location_context, 'Global (All Countries)') AS location,
                COALESCE(cp.industry_context, 'General') AS industry,
                cp.job_function_context AS job_function
            FROM public.confirmed_prompts cp
            JOIN public.companies c ON c.id = cp.company_id
            WHERE cp.company_id IN (SELECT company_id FROM org_companies)
              AND cp.is_active = true
        )
        INSERT INTO public.company_batch_queue (
            config_id, company_id, company_name, location, industry, job_function,
            phase, status
        )
        SELECT
            v_config_id, company_id, company_name, location, industry, job_function,
            'llm_collection', 'pending'
        FROM combos;

        GET DIAGNOSTICS v_jobs_created = ROW_COUNT;

        IF v_project_url IS NOT NULL AND v_service_key IS NOT NULL AND v_jobs_created > 0 THEN
            PERFORM net.http_post(
                url := v_project_url || '/functions/v1/process-company-batch-queue',
                headers := jsonb_build_object(
                    'Authorization', 'Bearer ' || v_service_key,
                    'Content-Type', 'application/json'
                ),
                body := jsonb_build_object('configId', v_config_id)
            );
        END IF;

        PERFORM public.send_batch_alert(jsonb_build_object(
            'event', 'monthly_refresh_started',
            'text', format(
                'Monthly refresh for *%s* (month: %s). %s jobs queued — will re-collect any (prompt, model) pair missing a %s response.',
                v_org.name, v_current_month, v_jobs_created, v_current_month
            ),
            'fields', jsonb_build_array(
                jsonb_build_object('label', 'Organization', 'value', v_org.name),
                jsonb_build_object('label', 'Month',        'value', v_current_month),
                jsonb_build_object('label', 'Jobs queued',  'value', v_jobs_created::text),
                jsonb_build_object('label', 'Config',       'value', v_config_id::text)
            )
        ));

        v_orgs_refreshed := v_orgs_refreshed + 1;
        v_total_jobs := v_total_jobs + v_jobs_created;
    END LOOP;

    RETURN jsonb_build_object(
        'month', v_current_month,
        'orgs_refreshed', v_orgs_refreshed,
        'total_jobs', v_total_jobs
    );
END;
$$;
