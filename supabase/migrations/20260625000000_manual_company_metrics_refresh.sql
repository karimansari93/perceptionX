-- ============================================================================
-- Manual, on-demand refresh of the company-metrics rollups
-- ============================================================================
-- The hourly `refresh-company-metrics-every-hour` cron (SELECT
-- refresh_company_metrics()) was disabled because refreshing all 13 rollup MVs
-- every hour pressured instance memory. We keep that cron OFF and instead give
-- admins an on-demand trigger (a "Refresh metrics" button in the admin UI).
--
-- The full refresh takes minutes — longer than the 60s PostgREST/edge timeout —
-- so it can't run synchronously inside a request. This RPC instead schedules a
-- one-off pg_cron job that runs the refresh server-side. The job is:
--   * advisory-locked   — a second trigger while one is running is a no-op, so
--                         clicks can't stack concurrent refreshes (the kind of
--                         overlap that contributed to the original memory
--                         pressure);
--   * sequential        — refresh_company_metrics() already refreshes one MV at
--                         a time, so peak memory stays ~one MV, not all 13;
--   * self-unscheduling — removes its own cron entry once it succeeds.
-- work_mem is already small (~3.5MB) so heavy aggregations spill to temp disk
-- rather than RAM; no memory-cap tuning is needed here.
CREATE OR REPLACE FUNCTION public.request_company_metrics_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can trigger a company-metrics refresh';
  END IF;

  -- Don't stack: if a manual refresh is already scheduled/running, report it.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneoff_company_metrics_refresh') THEN
    RETURN jsonb_build_object('status', 'already_running');
  END IF;

  PERFORM cron.schedule(
    'oneoff_company_metrics_refresh',
    '* * * * *',
    $job$
DO $do$
BEGIN
  -- Overlap guard: only one refresh runs at a time. The advisory lock is
  -- session-scoped, so it auto-releases when this cron worker exits, even on
  -- error (in which case the job stays scheduled and retries next minute).
  IF pg_try_advisory_lock(913371) THEN
    PERFORM public.refresh_company_metrics();
    PERFORM cron.unschedule('oneoff_company_metrics_refresh');
  END IF;
END
$do$;
    $job$
  );

  RETURN jsonb_build_object('status', 'scheduled');
END;
$func$;

GRANT EXECUTE ON FUNCTION public.request_company_metrics_refresh() TO authenticated;

COMMENT ON FUNCTION public.request_company_metrics_refresh() IS
  'Admin-only. Schedules a one-off, overlap-guarded, self-cleaning pg_cron job to refresh the company-metrics rollup MVs in the background. The hourly cron stays disabled to avoid the memory pressure it caused.';

NOTIFY pgrst, 'reload schema';
