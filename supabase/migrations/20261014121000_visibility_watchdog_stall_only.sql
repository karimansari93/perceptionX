-- Visibility queue watchdog: act only when the whole queue has stalled.
--
-- The previous version treated every pending job untouched for 5 minutes as
-- stranded. The processor works one prompt at a time through a single
-- self-chaining loop, so in a large run (the October 2026 index expansion
-- queues ~2,250 jobs) almost every queued job sits idle for more than 5
-- minutes while waiting its turn. The old watchdog would reset them all every
-- minute, start a new processor chain each time (chains never stop while work
-- remains, so they multiply and collect the same prompts in parallel), and post
-- a Slack alert every minute.
--
-- Now: if any live job was updated in the last 5 minutes, the chain is alive
-- and nothing happens. Only when no live job has moved for 5 minutes do we
-- reset jobs stuck in 'processing', fail the ones that have used their
-- retries, re-kick the processor once and alert once.
CREATE OR REPLACE FUNCTION public.visibility_queue_watchdog_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_project_url TEXT := public.batch_alert_setting('supabase_url');
  v_service_key TEXT := public.batch_alert_setting('service_role_key');
  v_live integer;
  v_reset_count integer := 0;
  v_failed_count integer := 0;
BEGIN
  SELECT COUNT(*) INTO v_live
  FROM public.visibility_queue
  WHERE status IN ('pending', 'processing')
    AND (is_cancelled IS NULL OR is_cancelled = false);

  IF v_live = 0 THEN
    RETURN jsonb_build_object('live', 0, 'stalled', false);
  END IF;

  -- Chain is alive: some live job moved recently.
  IF EXISTS (
    SELECT 1 FROM public.visibility_queue
    WHERE status IN ('pending', 'processing')
      AND (is_cancelled IS NULL OR is_cancelled = false)
      AND updated_at >= NOW() - INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('live', v_live, 'stalled', false);
  END IF;

  WITH failed AS (
    UPDATE public.visibility_queue
    SET status = 'failed',
        error_log = COALESCE(error_log, '') || ' | watchdog: retries exhausted at ' || NOW()::text,
        updated_at = NOW()
    WHERE status = 'processing'
      AND (is_cancelled IS NULL OR is_cancelled = false)
      AND COALESCE(retry_count, 0) >= 3
    RETURNING id
  )
  SELECT COUNT(*) INTO v_failed_count FROM failed;

  WITH reset AS (
    UPDATE public.visibility_queue
    SET status = 'pending',
        retry_count = COALESCE(retry_count, 0) + 1,
        error_log = COALESCE(error_log, '') || ' | watchdog reset at ' || NOW()::text,
        updated_at = NOW()
    WHERE status = 'processing'
      AND (is_cancelled IS NULL OR is_cancelled = false)
      AND COALESCE(retry_count, 0) < 3
    RETURNING id
  )
  SELECT COUNT(*) INTO v_reset_count FROM reset;

  IF v_project_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_project_url || '/functions/v1/process-visibility-queue',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;

  PERFORM public.send_batch_alert(jsonb_build_object(
    'event', 'visibility_stuck_jobs_reset',
    'text', format(
      'Visibility queue stalled for 5+ minutes (%s jobs left). Processor re-kicked; %s reset, %s failed after retries.',
      v_live, v_reset_count, v_failed_count
    ),
    'fields', jsonb_build_array(
      jsonb_build_object('label', 'Jobs left', 'value', v_live::text),
      jsonb_build_object('label', 'Reset', 'value', v_reset_count::text),
      jsonb_build_object('label', 'Failed', 'value', v_failed_count::text)
    )
  ));

  RETURN jsonb_build_object('live', v_live, 'stalled', true, 'reset', v_reset_count, 'failed', v_failed_count);
END;
$function$;
