-- =============================================================================
-- Self-healing RPC for stale canonicalization suggestions.
--
-- A suggestion can end up "orphaned" (status='pending' yet
-- entity_aliases already has a row for the same normalized key) when
-- aliases get created outside the admin approve flow — e.g. via the seed
-- migration or one-off SQL inserts. The Pending tab then keeps showing
-- variants that are effectively already mapped.
--
-- This RPC is idempotent: every call flips orphan pending rows to
-- approved + links them to their existing canonical. The edge function
-- calls it at the start of every run so the queue self-heals.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_orphan_canonicalization_suggestions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_affected int;
BEGIN
    WITH resolved AS (
        UPDATE public.entity_alias_suggestions sug
        SET status = 'approved',
            resolved_canonical_id = ea.canonical_id,
            resolved_at = COALESCE(sug.resolved_at, now())
        FROM public.entity_aliases ea
        WHERE sug.normalized_alias = ea.normalized_alias
          AND sug.status = 'pending'
        RETURNING sug.id
    )
    SELECT count(*) INTO v_affected FROM resolved;

    RETURN jsonb_build_object('resolved', v_affected);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_orphan_canonicalization_suggestions()
    TO service_role, authenticated;
