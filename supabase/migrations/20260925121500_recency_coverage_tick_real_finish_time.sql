-- now() is the transaction start, so last_finished always equalled
-- last_started. Record the actual wall-clock finish of the rebuild.
CREATE OR REPLACE FUNCTION public.recency_coverage_refresh_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  s public.recency_coverage_refresh_state;
  v_requested timestamptz;
  v_errors text;
BEGIN
  SELECT * INTO s FROM public.recency_coverage_refresh_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;  -- another tick is already refreshing

  SELECT requested_at INTO v_requested FROM public.recency_coverage_refresh_request WHERE id = 1;

  IF NOT (
    s.last_finished IS NULL
    OR s.last_finished < now() - interval '1 hour'
    OR (v_requested IS NOT NULL AND v_requested > COALESCE(s.last_started, '-infinity'))
  ) THEN
    RETURN;
  END IF;

  UPDATE public.recency_coverage_refresh_state SET last_started = now() WHERE id = 1;

  SELECT string_agg(view_name || ': ' || error_message, '; ')
  INTO v_errors
  FROM public.refresh_organization_recency_coverage()
  WHERE NOT success;

  UPDATE public.recency_coverage_refresh_state
  SET last_finished = clock_timestamp(), last_error = v_errors
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.recency_coverage_refresh_tick() FROM PUBLIC, anon, authenticated;
