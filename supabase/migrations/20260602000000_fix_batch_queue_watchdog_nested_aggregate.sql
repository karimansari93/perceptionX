-- Fix batch_queue_watchdog_tick: it raised
--   "aggregate function calls cannot be nested"
-- on every run because v_by_company was computed as
--   jsonb_object_agg(company_name, COUNT(*) FILTER (...))
-- which nests COUNT() inside jsonb_object_agg(). That error made the watchdog
-- cron a no-op, so stranded batch jobs (status stuck in 'processing' after a
-- chunk) were never reset back to 'pending' and collection stalled after the
-- first 2-prompt chunk per job. The cron was consequently left disabled.
--
-- Fix: aggregate the per-company counts in a separate grouped CTE first, then
-- roll that up with scalar subqueries so no aggregate is nested. Behaviour is
-- otherwise identical (reset rows idle >5min with retry_count<3, re-kick their
-- configs, send a Slack alert).

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
    ),
    by_company AS (
        SELECT COALESCE(company_name, '(unknown)') AS company_name, COUNT(*) AS cnt
        FROM updated
        GROUP BY COALESCE(company_name, '(unknown)')
    )
    SELECT
        (SELECT COUNT(*) FROM updated),
        (SELECT array_agg(DISTINCT config_id) FROM updated),
        (SELECT jsonb_object_agg(company_name, cnt) FROM by_company)
    INTO v_reset_count, v_config_ids, v_by_company;

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
        'configs_kicked', COALESCE(array_length(v_config_ids, 1), 0),
        'by_company', v_by_company
    );
END;
$$;

-- Re-enable the self-healing crons that depend on this function. They were
-- left disabled while the watchdog was erroring; without them batch collection
-- stalls after the first chunk of each job.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'batch-queue-watchdog'), active := true);
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'batch-queue-completion-sweep'), active := true);
