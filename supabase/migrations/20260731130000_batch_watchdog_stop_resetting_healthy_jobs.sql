-- ============================================================================
-- Batch watchdog: stop resetting jobs that were never stranded
-- ============================================================================
--
-- Symptom: "Batch watchdog: reset stranded jobs" fired in Slack every ~5
-- minutes, for days, on a run that was still making progress. Three separate
-- causes, all fixed here.
--
--  1. A queue row is left in status='pending' *between* chunks (that's
--     deliberate — see the processor — so the next chained worker can re-claim
--     it immediately). The watchdog treated any pending row idle for 5 minutes
--     as stranded, so every row queued behind an actively-collecting sibling
--     got "reset" once per watchdog pass: retry_count bumped, error_log
--     polluted, Slack alerted — while nothing was actually wrong.
--
--     Now only status='processing' rows are reset. Those are genuinely owned by
--     a worker, so 5 minutes without an update does mean that worker died. A
--     pending row needs no state change at all — it needs a worker, which is
--     what the kick below is for.
--
--  2. Kicks were sent whenever anything looked stranded, once per config. Now a
--     config is kicked only when it is actually stalled: it still has claimable
--     work and *nothing* in it has moved for 5 minutes. Parallelism within a
--     live run is the processor's job (it fans out across rows), not the
--     watchdog's.
--
--  3. Rows that exhausted the retry budget (retry_count >= 3) were skipped by
--     the reset — but nothing ever moved them out of pending/processing, so
--     they stayed "in flight" forever, and their config could never reach a
--     terminal state. They are now marked failed, which lets the completion
--     sweep close the config out.
--
-- Plus: the Slack alert is rate-limited to once per 15 minutes (the watchdog
-- runs every minute), and a config that gets resumed has its alerted_final_at
-- cleared so the completion sweep can report the *real* ending.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Alert rate-limit state. Single row, keyed on a constant.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batch_watchdog_alert_state (
    id            boolean PRIMARY KEY DEFAULT true CHECK (id),
    last_alert_at TIMESTAMPTZ
);

INSERT INTO public.batch_watchdog_alert_state (id, last_alert_at)
VALUES (true, NULL)
ON CONFLICT (id) DO NOTHING;

-- Cron/SECURITY DEFINER access only; no client ever reads this.
ALTER TABLE public.batch_watchdog_alert_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.batch_watchdog_alert_state IS
'Single-row throttle for batch_queue_watchdog_tick Slack alerts (see last_alert_at).';

CREATE OR REPLACE FUNCTION public.batch_queue_watchdog_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_idle        INTERVAL := INTERVAL '5 minutes';
    v_gave_up     integer := 0;
    v_reset_count integer := 0;
    v_reset_configs uuid[] := '{}';
    v_kick_configs  uuid[] := '{}';
    v_config_id   uuid;
    v_last_alert  TIMESTAMPTZ;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    -- ------------------------------------------------------------------
    -- 1. Give up on rows that burned their retry budget. Without this they
    --    sit in pending/processing forever and keep their config off the
    --    completion sweep.
    -- ------------------------------------------------------------------
    WITH gave_up AS (
        UPDATE public.company_batch_queue
        SET status = 'failed',
            error_log = COALESCE(error_log, '') ||
                        ' | watchdog gave up after 3 resets at ' || NOW()::text,
            updated_at = NOW()
        WHERE status IN ('pending', 'processing')
          AND (is_cancelled IS NULL OR is_cancelled = false)
          AND updated_at < NOW() - v_idle
          AND COALESCE(retry_count, 0) >= 3
        RETURNING id
    )
    SELECT COUNT(*) INTO v_gave_up FROM gave_up;

    -- ------------------------------------------------------------------
    -- 2. Reset rows whose worker died mid-chunk. ONLY 'processing' rows:
    --    a pending row is not owned by anyone, so it is not stranded — it is
    --    simply queued, and resetting it would corrupt its retry budget.
    -- ------------------------------------------------------------------
    WITH updated AS (
        UPDATE public.company_batch_queue
        SET status = 'pending',
            retry_count = COALESCE(retry_count, 0) + 1,
            error_log = COALESCE(error_log, '') ||
                        ' | watchdog reset at ' || NOW()::text,
            updated_at = NOW()
        WHERE status = 'processing'
          AND (is_cancelled IS NULL OR is_cancelled = false)
          AND updated_at < NOW() - v_idle
          AND COALESCE(retry_count, 0) < 3
        RETURNING config_id
    )
    SELECT COUNT(*), COALESCE(array_agg(DISTINCT config_id), '{}')
    INTO v_reset_count, v_reset_configs
    FROM updated;

    -- ------------------------------------------------------------------
    -- 3. Configs that are stalled: claimable work left, and nothing in the
    --    config has moved for 5 minutes (so no worker is alive on it). A
    --    config we just reset in step 2 always qualifies.
    -- ------------------------------------------------------------------
    SELECT COALESCE(array_agg(config_id), '{}')
    INTO v_kick_configs
    FROM (
        SELECT config_id
        FROM public.company_batch_queue
        WHERE status IN ('pending', 'processing')
          AND (is_cancelled IS NULL OR is_cancelled = false)
          AND COALESCE(retry_count, 0) < 3
        GROUP BY config_id
        HAVING COUNT(*) FILTER (WHERE status = 'pending') > 0
           AND (MAX(updated_at) < NOW() - v_idle OR config_id = ANY (v_reset_configs))
    ) stalled;

    IF v_gave_up = 0 AND v_reset_count = 0 AND array_length(v_kick_configs, 1) IS NULL THEN
        RETURN jsonb_build_object('gave_up', 0, 'reset', 0, 'configs_kicked', 0);
    END IF;

    -- A config that is being resumed has not really finished, whatever the
    -- completion sweep concluded earlier. Clear the marker so the sweep can
    -- report the run's actual ending.
    UPDATE public.company_batch_configs
    SET alerted_final_at = NULL
    WHERE id = ANY (v_kick_configs)
      AND alerted_final_at IS NOT NULL;

    -- ------------------------------------------------------------------
    -- 4. Kick one root worker per stalled config. The processor fans out from
    --    there across that config's rows, so one kick is enough.
    -- ------------------------------------------------------------------
    IF v_project_url IS NOT NULL AND v_service_key IS NOT NULL THEN
        FOREACH v_config_id IN ARRAY v_kick_configs
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

    -- ------------------------------------------------------------------
    -- 5. Alert, at most once every 15 minutes. The watchdog runs every minute;
    --    an unthrottled alert turns any long-running incident into a Slack
    --    flood that nobody reads.
    -- ------------------------------------------------------------------
    SELECT last_alert_at INTO v_last_alert
    FROM public.batch_watchdog_alert_state WHERE id;

    IF v_last_alert IS NULL OR v_last_alert < NOW() - INTERVAL '15 minutes' THEN
        PERFORM public.send_batch_alert(jsonb_build_object(
            'event', 'stuck_jobs_reset',
            'text', format(
                '%s stalled job%s reset, %s config%s resumed, %s job%s failed after 3 resets.',
                v_reset_count,
                CASE WHEN v_reset_count = 1 THEN '' ELSE 's' END,
                COALESCE(array_length(v_kick_configs, 1), 0),
                CASE WHEN array_length(v_kick_configs, 1) = 1 THEN '' ELSE 's' END,
                v_gave_up,
                CASE WHEN v_gave_up = 1 THEN '' ELSE 's' END
            ),
            'fields', jsonb_build_array(
                jsonb_build_object('label', 'Reset', 'value', v_reset_count::text),
                jsonb_build_object('label', 'Configs resumed',
                                   'value', COALESCE(array_length(v_kick_configs, 1), 0)::text),
                jsonb_build_object('label', 'Gave up', 'value', v_gave_up::text)
            )
        ));

        UPDATE public.batch_watchdog_alert_state SET last_alert_at = NOW() WHERE id;
    END IF;

    RETURN jsonb_build_object(
        'gave_up', v_gave_up,
        'reset', v_reset_count,
        'configs_kicked', COALESCE(array_length(v_kick_configs, 1), 0)
    );
END;
$$;

COMMENT ON FUNCTION public.batch_queue_watchdog_tick IS
'Resets company_batch_queue rows whose worker died (processing + idle 5 min), fails rows past the retry budget, kicks configs where nothing has moved for 5 minutes, and emits a rate-limited Slack alert. Called every minute by pg_cron.';

-- ----------------------------------------------------------------------------
-- Completion sweep: ignore cancelled rows.
--
-- "Stop run" sets is_cancelled without changing status, so cancelled rows sat
-- in pending/processing forever and the config could never satisfy
-- "no in-flight rows" — no completion alert, ever.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batch_queue_completion_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_config RECORD;
    v_alerts_sent integer := 0;
BEGIN
    FOR v_config IN
        SELECT
            cfg.id AS config_id,
            cfg.company_name,
            cfg.organization_id,
            cfg.created_at,
            COUNT(q.*)                                       AS total,
            COUNT(q.*) FILTER (WHERE q.status = 'completed') AS completed,
            COUNT(q.*) FILTER (WHERE q.status = 'failed')    AS failed
        FROM public.company_batch_configs cfg
        JOIN public.company_batch_queue q ON q.config_id = cfg.id
        WHERE cfg.alerted_final_at IS NULL
        GROUP BY cfg.id, cfg.company_name, cfg.organization_id, cfg.created_at
        HAVING COUNT(q.*) FILTER (
                 WHERE q.status IN ('pending', 'processing')
                   AND (q.is_cancelled IS NULL OR q.is_cancelled = false)
               ) = 0
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

-- ----------------------------------------------------------------------------
-- One-time cleanup: rows cancelled by an operator months ago are still sitting
-- in pending/processing (Ford, GSK, Netflix, Walmart runs). Close them out so
-- they stop counting as in-flight.
-- ----------------------------------------------------------------------------
UPDATE public.company_batch_queue
SET status = 'failed',
    error_log = COALESCE(error_log, '') || ' | cancelled by operator',
    updated_at = NOW()
WHERE status IN ('pending', 'processing')
  AND is_cancelled = true;

GRANT EXECUTE ON FUNCTION public.batch_queue_watchdog_tick() TO service_role;
GRANT EXECUTE ON FUNCTION public.batch_queue_completion_tick() TO service_role;
