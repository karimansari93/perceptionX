-- Visibility queue: driven by pg_cron instead of a self-chaining edge function.
--
-- process-visibility-queue used to process one prompt and then fire-and-forget
-- a call to itself. That call is sometimes lost when the function exits, so the
-- chain stalled (2-3 times in the 104-prompt Japan pilot). The watchdog then
-- reset every job in 'processing' and bumped its retry_count; in a run of
-- thousands of round-robin jobs, a few stalls would push most jobs to 'failed'.
--
-- Now a cron job calls the processor every minute while collection is active;
-- each call works for ~45 seconds and returns, so runs never overlap and a lost
-- run is just replaced by the next one. retry_count only counts real collector
-- errors (handled in the processor). The watchdog only alerts, once per stall.

SELECT cron.schedule(
  'visibility-queue-processor',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := public.batch_alert_setting('supabase_url') || '/functions/v1/process-visibility-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || public.batch_alert_setting('service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.visibility_queue
    WHERE status IN ('pending', 'processing')
      AND (is_cancelled IS NULL OR is_cancelled = false)
  );
  $$
);

CREATE OR REPLACE FUNCTION public.visibility_queue_watchdog_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_live integer;
  v_last_update timestamptz;
BEGIN
  SELECT COUNT(*), MAX(updated_at) INTO v_live, v_last_update
  FROM public.visibility_queue
  WHERE status IN ('pending', 'processing')
    AND (is_cancelled IS NULL OR is_cancelled = false);

  IF v_live = 0 THEN
    RETURN jsonb_build_object('live', 0, 'stalled', false);
  END IF;

  -- Alert once, in the minute the queue crosses 10 minutes without progress.
  IF v_last_update < NOW() - INTERVAL '10 minutes'
     AND v_last_update >= NOW() - INTERVAL '11 minutes' THEN
    PERFORM public.send_batch_alert(jsonb_build_object(
      'event', 'visibility_queue_stalled',
      'text', format(
        'Visibility queue has made no progress for 10 minutes (%s jobs left). The every-minute processor should pick it up; check process-visibility-queue logs if this repeats.',
        v_live
      ),
      'fields', jsonb_build_array(
        jsonb_build_object('label', 'Jobs left', 'value', v_live::text)
      )
    ));
    RETURN jsonb_build_object('live', v_live, 'stalled', true, 'alerted', true);
  END IF;

  RETURN jsonb_build_object('live', v_live, 'stalled', v_last_update < NOW() - INTERVAL '10 minutes');
END;
$function$;
