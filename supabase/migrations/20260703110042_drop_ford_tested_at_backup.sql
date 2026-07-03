-- Drop stale backup table flagged by Supabase Security Advisor (rls_disabled_in_public).
-- public.ford_tested_at_backup_20260520 was a one-off backup (created 2026-05-20) left in the
-- public schema with Row-Level Security disabled, exposing all rows to the anon/authenticated
-- roles. Nothing in the application code references it, so it is safe to remove entirely rather
-- than lock down with RLS policies.
DROP TABLE IF EXISTS public.ford_tested_at_backup_20260520;
