-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260205150000; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Enable the pg_cron extension to schedule jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions
-- Schedule the refresh function to run every hour
-- The job name is 'refresh-rankings-every-hour'
-- The schedule '0 * * * *' means "at minute 0 of every hour"
SELECT cron.schedule(
  'refresh-rankings-every-hour',
  '0 * * * *',
  $$SELECT refresh_rankings_views()$$
)
-- Note: To unschedule, you can run: SELECT cron.unschedule('refresh-rankings-every-hour');
