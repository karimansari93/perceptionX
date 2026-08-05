-- =============================================================================
-- Background drain for high-confidence entity canonicalization suggestions.
--
-- auto_apply_entity_suggestions (20260805120000) does the actual applying, but
-- callers coming through PostgREST are capped by role statement_timeouts
-- (authenticated/service_role: 8s). Approving a popular variant rewrites every
-- historical prompt_responses row that mentions it (recanonicalization
-- trigger), so a batch of high-mention names can take minutes — far past any
-- API timeout.
--
-- pg_cron jobs run as postgres with no statement_timeout, so the drain lives
-- here: a tick every 2 minutes applies eligible suggestions in small batches
-- until the queue is empty. An advisory lock makes overlapping ticks no-ops
-- (a heavy drain can outlast the 2-minute interval).
--
-- The edge function and the admin UI still call the RPC directly for instant
-- feedback on light queues; when they hit the API timeout the tick finishes
-- the job within a couple of minutes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auto_apply_entity_suggestions_drain(
    p_max_batches integer DEFAULT 40,
    p_batch_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
    v_applied_total int := 0;
    v_new_canonicals_total int := 0;
    v_batches int := 0;
BEGIN
    IF NOT pg_try_advisory_lock(hashtext('auto_apply_entity_suggestions_drain')) THEN
        RETURN jsonb_build_object('skipped', true, 'reason', 'drain already running');
    END IF;

    BEGIN
        LOOP
            v_result := public.auto_apply_entity_suggestions(0.90, 0.95, p_batch_size);
            v_batches := v_batches + 1;
            v_applied_total := v_applied_total + COALESCE((v_result->>'applied')::int, 0);
            v_new_canonicals_total := v_new_canonicals_total + COALESCE((v_result->>'new_canonicals')::int, 0);
            EXIT WHEN COALESCE((v_result->>'applied')::int, 0) = 0
                   OR v_batches >= p_max_batches;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_advisory_unlock(hashtext('auto_apply_entity_suggestions_drain'));
        RAISE;
    END;

    PERFORM pg_advisory_unlock(hashtext('auto_apply_entity_suggestions_drain'));

    RETURN jsonb_build_object(
        'batches', v_batches,
        'applied', v_applied_total,
        'new_canonicals', v_new_canonicals_total,
        'remaining_eligible', v_result->'remaining_eligible',
        'remaining_pending', v_result->'remaining_pending'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_apply_entity_suggestions_drain(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_apply_entity_suggestions_drain(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_apply_entity_suggestions_drain(integer, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- Schedule: every 2 minutes. An empty queue costs one indexed lookup, and the
-- advisory lock keeps long drains from stacking. Runs right through the 03:00
-- UTC nightly suggestion job's output, so new variants are grouped within
-- minutes of being suggested.
--
-- The SET is load-bearing: cron sessions inherit a database-level
-- statement_timeout (~2min) that cancels and rolls back heavy drains, leaving
-- the same head-of-queue to fail every tick. pg_cron executes the command
-- string over simple query protocol where the timeout applies per statement,
-- so the SET takes effect before the drain runs. Work per tick is bounded
-- (5 batches x 10) to keep each transaction short; big backlogs clear over a
-- handful of ticks instead of one giant transaction.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM cron.unschedule('auto-apply-entity-suggestions');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'auto-apply-entity-suggestions',
    '*/2 * * * *',
    $cron$SET statement_timeout TO 0; SELECT public.auto_apply_entity_suggestions_drain(5, 10);$cron$
);
