-- ============================================================================
-- Cancelling a recency rescore should clear last_error
-- ============================================================================
-- Cancelling a rescore is a user action, not a failure, but the previous cancel
-- RPC left whatever transient batch error was last recorded in last_error. A
-- job that hit a single bad batch (e.g. extract-recency-scores returning a
-- non-2xx on a Firecrawl-batch timeout) and was then cancelled kept that error
-- pinned forever, so the admin "Recency Coverage" drill-down perpetually showed
-- a stale "Edge Function returned a non-2xx status code" banner long after the
-- run had finished.
--
-- Clear last_error on cancel, and normalize existing cancelled rows so the stale
-- banners go away.
CREATE OR REPLACE FUNCTION public.cancel_recency_rescore(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.recency_rescore_jobs
    SET is_cancelled = TRUE,
        status = 'cancelled',
        last_error = NULL,
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = p_job_id
      AND status IN ('queued', 'running');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_recency_rescore(UUID) TO authenticated;

-- One-off cleanup: existing cancelled jobs shouldn't carry a leftover error.
UPDATE public.recency_rescore_jobs
SET last_error = NULL
WHERE status = 'cancelled'
  AND last_error IS NOT NULL;

NOTIFY pgrst, 'reload schema';
