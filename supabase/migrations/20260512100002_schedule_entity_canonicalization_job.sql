-- =============================================================================
-- Schedule the entity-canonicalization LLM suggestion job to run nightly.
--
-- Reads supabase_url + service_role_key from vault.decrypted_secrets the same
-- way recency_rescore_tick and monthly_auto_refresh do, and invokes the
-- suggest-entity-canonicalization edge function. Idempotent at the function
-- level — the edge function skips variants that are already mapped or already
-- queued.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.suggest_entity_canonicalization_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_request_id  BIGINT;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'suggest_entity_canonicalization_tick: missing supabase_url or service_role_key in vault, skipping';
        RETURN jsonb_build_object('kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    SELECT net.http_post(
        url := v_project_url || '/functions/v1/suggest-entity-canonicalization',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := jsonb_build_object('batchSize', 50)
    ) INTO v_request_id;

    RETURN jsonb_build_object('kicked', true, 'request_id', v_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_entity_canonicalization_tick() TO service_role;


-- ----------------------------------------------------------------------------
-- Schedule: 03:00 UTC every night.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM cron.unschedule('suggest-entity-canonicalization');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'suggest-entity-canonicalization',
    '0 3 * * *',  -- 03:00 UTC every day
    $cron$ SELECT public.suggest_entity_canonicalization_tick(); $cron$
);
