-- Move the theme-backfill safety net onto the Anthropic Message Batches API.
--
-- The edge function (theme-backfill-tick) now submits missing responses as
-- one async batch (50% token discount, no live rate-limit pressure) and
-- harvests results on later ticks. This table tracks in-flight batches so a
-- tick knows what to poll and never double-submits.
CREATE TABLE IF NOT EXISTS public.theme_backfill_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anthropic_batch_id text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    request_count integer NOT NULL,
    result_summary jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

-- Service-role only (edge function). RLS on with no policies blocks all
-- anon/authenticated access; service_role bypasses RLS.
ALTER TABLE public.theme_backfill_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_theme_backfill_batches_pending
ON public.theme_backfill_batches (created_at)
WHERE status = 'pending';

-- Restore the cron to every 5 minutes. It had been slowed to */20 with a
-- 30-response cap purely to keep synchronous Haiku calls under the org's
-- live rate limit; batch requests don't draw from that limit, and a faster
-- tick just means faster polling of batch completion.
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
