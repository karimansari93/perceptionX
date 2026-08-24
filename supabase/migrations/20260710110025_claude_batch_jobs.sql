-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260710110025; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Claude collection via the Anthropic Message Batches API (50% cheaper than
-- synchronous calls — discount applies to input, output, AND web-search tokens).
--
-- Flow:
--   1. collect-company-responses (claudeViaBatch: true, set by
--      process-company-batch-queue) strips 'claude' from its synchronous model
--      loop and invokes claude-batch-collector {action:'submit'} instead.
--   2. submit creates Anthropic Message Batches (custom_id = confirmed_prompt id)
--      and records them here.
--   3. claude_batch_tick (below, every 2 min) invokes
--      claude-batch-collector {action:'poll'}, which retrieves ended batches,
--      extracts text + citations, and feeds each result through analyze-response
--      exactly like the synchronous path.

CREATE TABLE IF NOT EXISTS public.claude_batch_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anthropic_batch_id text NOT NULL UNIQUE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    -- confirmed_prompt ids included in this Anthropic batch
    prompt_ids jsonb NOT NULL,
    -- in_progress -> completed | failed
    status text NOT NULL DEFAULT 'in_progress',
    submitted_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    results_processed int NOT NULL DEFAULT 0,
    results_succeeded int NOT NULL DEFAULT 0,
    error_log text
);

CREATE INDEX IF NOT EXISTS idx_claude_batch_jobs_status
    ON public.claude_batch_jobs (status)
    WHERE status = 'in_progress';

ALTER TABLE public.claude_batch_jobs ENABLE ROW LEVEL SECURITY;
-- Service-role only (edge functions); no anon/authenticated policies.

-- Poll tick: only fires the edge function while batches are actually pending,
-- so the cron is free when idle (same pattern as recency_rescore_tick).
CREATE OR REPLACE FUNCTION public.claude_batch_tick()
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
    FROM public.claude_batch_jobs
    WHERE status = 'in_progress';

    IF v_active_count = 0 THEN
        RETURN jsonb_build_object('active', 0, 'kicked', false);
    END IF;

    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'claude_batch_tick: missing supabase_url or service_role_key in vault, skipping';
        RETURN jsonb_build_object('active', v_active_count, 'kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    PERFORM net.http_post(
        url := v_project_url || '/functions/v1/claude-batch-collector',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := jsonb_build_object('action', 'poll')
    );

    RETURN jsonb_build_object('active', v_active_count, 'kicked', true);
END;
$$;

DO $$
BEGIN
    -- Unschedule first so the migration is idempotent on re-run.
    PERFORM cron.unschedule('claude-batch-tick')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'claude-batch-tick');

    PERFORM cron.schedule(
        'claude-batch-tick',
        '*/2 * * * *',
        $cron$SELECT public.claude_batch_tick();$cron$
    );
END
$$;
