-- Cron-callback PL/pgSQL functions previously read from
--   current_setting('app.settings.supabase_url')
--   current_setting('app.settings.service_role_key')
-- but those GUCs were never set on this project, so every tick took the
-- early-return path and silently no-op'd. The same values exist in
-- `vault.secrets` under names `supabase_url` and `service_role_key`, so
-- switch the reads to vault.
--
-- This unblocks: recency_rescore_tick, batch_queue_watchdog_tick, send_batch_alert,
-- and monthly_auto_refresh. Without this, the Ford recency rescore got stuck at
-- 500/61,043 for ~22 hours despite the cron firing every minute.

CREATE OR REPLACE FUNCTION public.recency_rescore_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_active_count INT;
BEGIN
    SELECT COUNT(*) INTO v_active_count
    FROM public.recency_rescore_jobs
    WHERE status IN ('queued', 'running');

    IF v_active_count = 0 THEN
        RETURN jsonb_build_object('active', 0, 'kicked', false);
    END IF;

    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'recency_rescore_tick: missing supabase_url or service_role_key in vault, skipping';
        RETURN jsonb_build_object('active', v_active_count, 'kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    PERFORM net.http_post(
        url := v_project_url || '/functions/v1/process-recency-rescore-tick',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := '{}'::jsonb
    );

    RETURN jsonb_build_object('active', v_active_count, 'kicked', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.send_batch_alert(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_request_id bigint;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'send_batch_alert: missing supabase_url or service_role_key in vault, skipping';
        RETURN NULL;
    END IF;

    SELECT net.http_post(
        url := v_project_url || '/functions/v1/send-batch-alert',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := payload
    ) INTO v_request_id;

    RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_queue_watchdog_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_stranded_count integer;
    v_reset_count integer;
    v_config_ids uuid[];
    v_config_id uuid;
    v_by_company jsonb;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    SELECT COUNT(*)
    INTO v_stranded_count
    FROM public.company_batch_queue
    WHERE status IN ('pending', 'processing')
      AND (is_cancelled IS NULL OR is_cancelled = false)
      AND updated_at < NOW() - INTERVAL '5 minutes'
      AND COALESCE(retry_count, 0) < 3;

    IF v_stranded_count = 0 THEN
        RETURN jsonb_build_object('stranded', 0, 'reset', 0);
    END IF;

    WITH updated AS (
        UPDATE public.company_batch_queue
        SET status = 'pending',
            retry_count = COALESCE(retry_count, 0) + 1,
            error_log = COALESCE(error_log, '') ||
                        ' | watchdog reset at ' || NOW()::text,
            updated_at = NOW()
        WHERE status IN ('pending', 'processing')
          AND (is_cancelled IS NULL OR is_cancelled = false)
          AND updated_at < NOW() - INTERVAL '5 minutes'
          AND COALESCE(retry_count, 0) < 3
        RETURNING id, config_id, company_name, job_function
    )
    SELECT COUNT(*), array_agg(DISTINCT config_id),
           jsonb_object_agg(
             COALESCE(company_name, '(unknown)'),
             COUNT(*) FILTER (WHERE company_name IS NOT NULL)
           )
    INTO v_reset_count, v_config_ids, v_by_company
    FROM updated;

    IF v_project_url IS NOT NULL AND v_service_key IS NOT NULL THEN
        FOREACH v_config_id IN ARRAY v_config_ids
        LOOP
            PERFORM net.http_post(
                url := v_project_url || '/functions/v1/process-company-batch-queue',
                headers := jsonb_build_object(
                    'Authorization', 'Bearer ' || v_service_key,
                    'Content-Type', 'application/json'
                ),
                body := jsonb_build_object('configId', v_config_id)
            );
        END LOOP;
    END IF;

    PERFORM public.send_batch_alert(jsonb_build_object(
        'event', 'stuck_jobs_reset',
        'text', format(
            '%s job%s had been idle for 5+ minutes and were reset. %s config%s triggered to resume.',
            v_reset_count,
            CASE WHEN v_reset_count = 1 THEN '' ELSE 's' END,
            COALESCE(array_length(v_config_ids, 1), 0),
            CASE WHEN array_length(v_config_ids, 1) = 1 THEN '' ELSE 's' END
        ),
        'fields', jsonb_build_array(
            jsonb_build_object('label', 'Reset', 'value', v_reset_count::text),
            jsonb_build_object('label', 'Configs re-kicked',
                               'value', COALESCE(array_length(v_config_ids, 1), 0)::text)
        )
    ));

    RETURN jsonb_build_object(
        'stranded', v_stranded_count,
        'reset', v_reset_count,
        'configs_kicked', COALESCE(array_length(v_config_ids, 1), 0)
    );
END;
$$;

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
