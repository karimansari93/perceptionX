-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260511061237; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Same fix as for recency_rescore_tick: switch send_batch_alert,
-- batch_queue_watchdog_tick, and monthly auto-refresh callers off GUCs
-- (which were never set) and onto vault.decrypted_secrets.

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
