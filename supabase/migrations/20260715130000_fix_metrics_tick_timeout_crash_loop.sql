-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715130000; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Applied manually during 2026-07-15 incident via management API: cron.alter_job(refresh-metrics-tick) SET statement_timeout prefix; refresh_metrics_tick() catches query_canceled; CREATE INDEX CONCURRENTLY idx_prompt_responses_for_index_prompt. File in repo: supabase/migrations/20260715130000_fix_metrics_tick_timeout_crash_loop.sql
