-- ============================================================================
-- Batch queue watchdog + Slack alerts
-- ============================================================================
--
-- Three problems this migration addresses, all symptoms of the same root cause
-- (company_batch_queue relies on a fire-and-forget fetch() self-chain that
-- dies silently under load):
--
--   1. Stuck jobs sit in status='processing' or 'pending' for hours because
--      the self-chain broke. Admin had to manually click "Resume stuck jobs"
--      every time. No more — this cron resets + kicks automatically.
--
--   2. Failures went unnoticed until someone opened the dashboard. Now the
--      watchdog emits a Slack alert when a job exhausts retries or
--      when a run completes, so the team finds out within a minute.
--
--   3. No monthly refresh was automated. That's a separate migration below
--      (`monthly_netflix_refresh`) but it uses the same alert function.
--
-- Required Supabase extensions: pg_cron, pg_net (both enabled by default on
-- Supabase). Required secret in the edge runtime:
-- BATCH_ALERTS_SLACK_WEBHOOK (added via the Supabase dashboard).
-- ============================================================================

-- Ensure pg_net is available for calling edge functions from SQL.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ----------------------------------------------------------------------------
-- Helper: call the send-batch-alert edge function with a JSON body.
-- Centralizes the project-URL + service-role boilerplate so every cron job
-- that emits alerts reads the same 3 lines.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_batch_alert(payload jsonb)
RETURNS bigint  -- pg_net request_id for tracing
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT := current_setting('app.settings.supabase_url', true);
    v_service_key TEXT := current_setting('app.settings.service_role_key', true);
    v_request_id bigint;
BEGIN
    -- On Supabase, the project URL and service role key are exposed to SQL
    -- via custom GUCs. If they're unset (e.g. self-hosted without config),
    -- degrade gracefully instead of erroring every cron tick.
    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'send_batch_alert: missing supabase_url or service_role_key GUC, skipping';
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

COMMENT ON FUNCTION public.send_batch_alert IS
'Fire-and-forget POST to the send-batch-alert edge function. Returns the pg_net request id.';

-- ----------------------------------------------------------------------------
-- Watchdog: detect stranded company_batch_queue rows and reset them.
--
-- A row is "stranded" if it's in pending/processing state AND its updated_at
-- is older than 5 minutes AND it hasn't exhausted its retry budget. The
-- self-chain normally bumps updated_at every chunk, so 5 minutes of silence
-- reliably means the chain died.
--
-- On each reset: mark the row pending again, bump retry_count so we stop
-- after 3 consecutive watchdog resets (prevents infinite loops on jobs
-- that genuinely can't progress), and kick the queue processor for that
-- row's config. Post a Slack alert summarizing the reset.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batch_queue_watchdog_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT := current_setting('app.settings.supabase_url', true);
    v_service_key TEXT := current_setting('app.settings.service_role_key', true);
    v_stranded_count integer;
    v_reset_count integer;
    v_config_ids uuid[];
    v_config_id uuid;
    v_by_company jsonb;
BEGIN
    -- Count strandeds BEFORE updating so we can report them in the alert.
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

    -- Reset strandeds and capture their config_ids so we can kick the right
    -- processor invocations.
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

    -- Kick the queue processor once per affected config. Fire-and-forget.
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

    -- Emit Slack alert.
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

COMMENT ON FUNCTION public.batch_queue_watchdog_tick IS
'Resets stranded company_batch_queue rows (pending/processing + no update in 5 min), re-kicks their configs, and emits a Slack alert. Called every minute by pg_cron.';

-- ----------------------------------------------------------------------------
-- Alert: config-level completion / failure notifications.
--
-- We don't want an alert per queue row (too chatty on a 16-job run). Instead,
-- we track which configs we've already alerted on via a tiny marker column
-- and fire one alert per config when it reaches a terminal state.
--
-- Terminal states per config:
--   - all_completed:  every queue row for this config is 'completed'
--   - any_failed:     at least one queue row is 'failed' AND no pending/processing
-- ----------------------------------------------------------------------------
ALTER TABLE public.company_batch_configs
  ADD COLUMN IF NOT EXISTS alerted_final_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.batch_queue_completion_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_config RECORD;
    v_alerts_sent integer := 0;
BEGIN
    -- Walk configs that haven't been alerted and whose queue rows have all
    -- reached a terminal state. LIMIT 50 per tick so a huge backlog can't
    -- flood Slack in one go.
    FOR v_config IN
        SELECT
            cfg.id AS config_id,
            cfg.company_name,
            cfg.organization_id,
            cfg.created_at,
            COUNT(q.*)                                   AS total,
            COUNT(q.*) FILTER (WHERE q.status = 'completed') AS completed,
            COUNT(q.*) FILTER (WHERE q.status = 'failed')    AS failed,
            COUNT(q.*) FILTER (WHERE q.status IN ('pending', 'processing')) AS in_flight
        FROM public.company_batch_configs cfg
        JOIN public.company_batch_queue q ON q.config_id = cfg.id
        WHERE cfg.alerted_final_at IS NULL
        GROUP BY cfg.id, cfg.company_name, cfg.organization_id, cfg.created_at
        HAVING COUNT(q.*) FILTER (WHERE q.status IN ('pending', 'processing')) = 0
        ORDER BY cfg.created_at
        LIMIT 50
    LOOP
        IF v_config.failed > 0 THEN
            PERFORM public.send_batch_alert(jsonb_build_object(
                'event', 'config_failed',
                'text', format(
                    'Batch config for *%s* finished with failures. %s of %s jobs completed, %s failed.',
                    v_config.company_name, v_config.completed, v_config.total, v_config.failed
                ),
                'fields', jsonb_build_array(
                    jsonb_build_object('label', 'Completed', 'value', v_config.completed::text),
                    jsonb_build_object('label', 'Failed',    'value', v_config.failed::text),
                    jsonb_build_object('label', 'Config',    'value', v_config.config_id::text)
                )
            ));
        ELSE
            PERFORM public.send_batch_alert(jsonb_build_object(
                'event', 'config_completed',
                'text', format(
                    'Batch config for *%s* completed cleanly. %s jobs done.',
                    v_config.company_name, v_config.completed
                ),
                'fields', jsonb_build_array(
                    jsonb_build_object('label', 'Jobs',   'value', v_config.completed::text),
                    jsonb_build_object('label', 'Config', 'value', v_config.config_id::text)
                )
            ));
        END IF;

        UPDATE public.company_batch_configs
        SET alerted_final_at = NOW()
        WHERE id = v_config.config_id;

        v_alerts_sent := v_alerts_sent + 1;
    END LOOP;

    RETURN jsonb_build_object('alerts_sent', v_alerts_sent);
END;
$$;

COMMENT ON FUNCTION public.batch_queue_completion_tick IS
'Emits one Slack alert per company_batch_config that has reached a terminal state (no pending/processing rows). Marked via alerted_final_at so the same config is never alerted twice.';

-- ----------------------------------------------------------------------------
-- Schedule: watchdog every minute, completion sweep every 2 minutes.
-- Using pg_cron's cron.schedule. Job names prefixed with "batch_" so they're
-- easy to find in cron.job.
-- ----------------------------------------------------------------------------

-- If a previous version of these jobs exists, unschedule before re-creating.
DO $$
BEGIN
    PERFORM cron.unschedule('batch-queue-watchdog');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    PERFORM cron.unschedule('batch-queue-completion-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'batch-queue-watchdog',
    '* * * * *',  -- every minute
    $cron$ SELECT public.batch_queue_watchdog_tick(); $cron$
);

SELECT cron.schedule(
    'batch-queue-completion-sweep',
    '*/2 * * * *',  -- every 2 minutes
    $cron$ SELECT public.batch_queue_completion_tick(); $cron$
);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.send_batch_alert(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.batch_queue_watchdog_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.batch_queue_completion_tick() TO service_role;
