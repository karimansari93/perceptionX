-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260713073151; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Move the theme-backfill safety net onto the Anthropic Message Batches API.
CREATE TABLE IF NOT EXISTS public.theme_backfill_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anthropic_batch_id text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    request_count integer NOT NULL,
    result_summary jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

ALTER TABLE public.theme_backfill_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_theme_backfill_batches_pending
ON public.theme_backfill_batches (created_at)
WHERE status = 'pending';

DO $$
BEGIN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'theme-backfill-tick';

    PERFORM cron.schedule(
        'theme-backfill-tick',
        '*/5 * * * *',
        $cron$SELECT public.theme_backfill_tick();$cron$
    );
END
$$;
