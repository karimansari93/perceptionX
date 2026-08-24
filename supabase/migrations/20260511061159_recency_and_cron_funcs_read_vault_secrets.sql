-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260511061159; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- The original definitions of these cron-callback functions read from
-- `app.settings.supabase_url` / `app.settings.service_role_key` GUCs, but
-- those GUCs were never set on this project. The same secret values already
-- exist in `vault.secrets` under names `supabase_url` and `service_role_key`,
-- so switch the reads to vault. This unblocks the recency rescore worker,
-- the batch-queue watchdog, and the monthly auto-refresh — all of which
-- were silently no-opping with "missing_guc".

CREATE OR REPLACE FUNCTION public.recency_rescore_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_active_count INT;
BEGIN
    SELECT COUNT(*) INTO v_active_count
    FROM public.recency_rescore_jobs
    WHERE status IN ('queued', 'running');

    IF v_active_count = 0 THEN
        RETURN jsonb_build_object('active', 0, 'kicked', false);
    END IF;

    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'recency_rescore_tick: missing supabase_url or service_role_key in vault, skipping';
        RETURN jsonb_build_object('active', v_active_count, 'kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    PERFORM net.http_post(
        url := v_project_url || '/functions/v1/process-recency-rescore-tick',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := '{}'::jsonb
    );

    RETURN jsonb_build_object('active', v_active_count, 'kicked', true);
END;
$$;
