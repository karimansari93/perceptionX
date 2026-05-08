-- ============================================================================
-- Background recency rescore jobs
-- ============================================================================
-- Replaces the in-browser loop in RecencyCoverageTab with a server-side
-- queue. Mirrors the company_batch_queue + watchdog pattern:
--
--   1. Admin enqueues a job for an org → row inserted in 'queued' state.
--   2. A cron tick fires every minute; if any 'queued'/'running' job
--      exists, it invokes the process-recency-rescore-tick edge function.
--   3. The edge function pulls the oldest active job, processes a few
--      batches of missing URLs via extract-recency-scores, then exits.
--      Each batch checks is_cancelled so the user can stop mid-run.
--   4. When the org has no missing URLs left, the job is marked 'done'
--      and a Slack alert fires via send_batch_alert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recency_rescore_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'cancelled', 'done', 'error')),
    total           INT NOT NULL DEFAULT 0,
    processed       INT NOT NULL DEFAULT 0,
    is_cancelled    BOOLEAN NOT NULL DEFAULT FALSE,
    last_error      TEXT,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

-- Only one active job per org at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recency_rescore_one_active_per_org
    ON public.recency_rescore_jobs(organization_id)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_recency_rescore_status
    ON public.recency_rescore_jobs(status, created_at);

CREATE TRIGGER update_recency_rescore_jobs_updated_at
    BEFORE UPDATE ON public.recency_rescore_jobs
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE public.recency_rescore_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything with recency rescore jobs"
    ON public.recency_rescore_jobs FOR ALL
    USING (is_admin());

-- ----------------------------------------------------------------------------
-- RPC: enqueue a rescore job for an org. Returns the job id, or the id of an
-- existing active job if one is already in flight.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_recency_rescore(p_org UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing UUID;
    v_total    INT;
    v_id       UUID;
BEGIN
    -- Return the existing active job if one already exists for this org.
    SELECT id INTO v_existing
    FROM public.recency_rescore_jobs
    WHERE organization_id = p_org
      AND status IN ('queued', 'running')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Snapshot the count of missing URLs at enqueue time so the UI can show
    -- a meaningful progress denominator. The worker re-queries on each tick
    -- so the actual work is always against fresh data.
    SELECT COUNT(*) INTO v_total
    FROM public.v_organization_url_status
    WHERE organization_id = p_org
      AND extraction_method IS NULL;

    INSERT INTO public.recency_rescore_jobs (organization_id, total, created_by)
    VALUES (p_org, v_total, auth.uid())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_recency_rescore(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: cancel an active rescore job. Sets is_cancelled so the worker stops
-- between batches, and flips status to 'cancelled'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_recency_rescore(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.recency_rescore_jobs
    SET is_cancelled = TRUE,
        status = 'cancelled',
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = p_job_id
      AND status IN ('queued', 'running');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_recency_rescore(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- Cron tick: every minute, if any active job exists, kick the edge function.
-- Same pattern as batch_queue_watchdog_tick — pg_net fire-and-forget.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recency_rescore_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_url TEXT := current_setting('app.settings.supabase_url', true);
    v_service_key TEXT := current_setting('app.settings.service_role_key', true);
    v_active_count INT;
BEGIN
    SELECT COUNT(*) INTO v_active_count
    FROM public.recency_rescore_jobs
    WHERE status IN ('queued', 'running');

    IF v_active_count = 0 THEN
        RETURN jsonb_build_object('active', 0, 'kicked', false);
    END IF;

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'recency_rescore_tick: missing supabase_url or service_role_key GUC, skipping';
        RETURN jsonb_build_object('active', v_active_count, 'kicked', false, 'reason', 'missing_guc');
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

GRANT EXECUTE ON FUNCTION public.recency_rescore_tick() TO service_role;

COMMENT ON FUNCTION public.recency_rescore_tick IS
'Cron-driven kick for the recency rescore worker. Fires every minute when an active job exists.';

-- Schedule: every minute. Unschedule any prior version first.
DO $$
BEGIN
    PERFORM cron.unschedule('recency-rescore-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'recency-rescore-tick',
    '* * * * *',
    $cron$ SELECT public.recency_rescore_tick(); $cron$
);

NOTIFY pgrst, 'reload schema';
