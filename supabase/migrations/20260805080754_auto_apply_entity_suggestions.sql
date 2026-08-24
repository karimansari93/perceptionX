-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260805080754; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- =============================================================================
-- Automatic application of high-confidence entity canonicalization suggestions
--
-- Why: the LLM suggestion job (suggest-entity-canonicalization, nightly cron)
-- fills entity_alias_suggestions, but nothing was grouped until an admin
-- manually approved each row in the Data Cleanup tab. Meanwhile unapproved
-- variants ("Hyundai Germany", "Pepsi") stay ungrouped in SOV/competitor
-- analysis, splitting mentions across spellings. The manual queue regularly
-- backs up into the hundreds.
--
-- This function closes the loop: it applies pending suggestions whose LLM
-- confidence clears a threshold, doing set-based what the admin UI's
-- approveSuggestion does row-by-row:
--   1. create the canonical entity if it doesn't exist yet
--      (non_entity suggestions become inactive canonicals, which the
--       competitors rollup then drops — same as manual approval),
--   2. insert the alias mapping raw variant -> canonical,
--   3. mark the suggestion approved with resolved_canonical_id,
--   4. flag the competitors rollups stale so the metrics tick rebuilds them.
--
-- Retroactive rewriting of prompt_responses.canonical_competitors happens via
-- the existing statement-level trigger on entity_aliases (see
-- 20260610000000_write_time_canonicalization.sql), so approved groupings apply
-- to history automatically.
--
-- Called by the suggest-entity-canonicalization edge function after every run
-- (so the nightly cron is now fully hands-off) and by the admin UI's
-- "Auto-group high-confidence" button. Low-confidence suggestions still land
-- in the Pending tab for human review — the queue becomes an exception list
-- instead of a required chore.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auto_apply_entity_suggestions(
    p_min_confidence numeric DEFAULT 0.90,
    p_min_confidence_non_entity numeric DEFAULT 0.95,
    p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_canonicals int := 0;
    v_applied int := 0;
    v_non_entity int := 0;
    v_remaining_eligible int := 0;
    v_remaining_pending int := 0;
BEGIN
    -- SECURITY DEFINER bypasses RLS, so gate explicitly: the mapping tables
    -- are global (a decision here applies to every tenant). Direct connections
    -- (postgres / SQL editor) have no JWT, hence the current_user check.
    IF NOT (
        COALESCE(auth.role(), '') = 'service_role'
        OR current_user IN ('postgres', 'supabase_admin')
        OR public.is_admin()
    ) THEN
        RAISE EXCEPTION 'auto_apply_entity_suggestions: admin or service role required';
    END IF;

    -- Suggestions whose alias already exists are just bookkeeping drift.
    PERFORM public.resolve_orphan_canonicalization_suggestions();

    DROP TABLE IF EXISTS _auto_apply_batch;
    CREATE TEMP TABLE _auto_apply_batch AS
    SELECT s.id,
           s.raw_alias,
           s.normalized_alias,
           s.suggested_is_non_entity,
           COALESCE(NULLIF(btrim(s.suggested_canonical_name), ''), s.raw_alias) AS target_name,
           CASE WHEN s.suggested_is_non_entity THEN 'non_entity'
                ELSE COALESCE(NULLIF(btrim(s.suggested_entity_type), ''), 'other')
           END AS target_type,
           NOT s.suggested_is_non_entity AS target_active,
           public.normalize_entity_name(
               COALESCE(NULLIF(btrim(s.suggested_canonical_name), ''), s.raw_alias)
           ) AS target_norm
    FROM public.entity_alias_suggestions s
    WHERE s.status = 'pending'
      AND s.confidence IS NOT NULL
      AND (
            (NOT s.suggested_is_non_entity
             AND s.suggested_canonical_name IS NOT NULL
             AND s.confidence >= p_min_confidence)
         -- Non-entity is the riskier call (a false positive silently drops a
         -- real company from SOV), so it gets its own, stricter threshold.
         OR (s.suggested_is_non_entity
             AND s.confidence >= p_min_confidence_non_entity)
      )
    ORDER BY s.mention_count DESC
    LIMIT p_limit;

    DELETE FROM _auto_apply_batch WHERE target_norm IS NULL;

    -- 1. Create canonicals that don't exist yet. Existing canonicals are left
    --    untouched (never flip is_active from here). ON CONFLICT DO NOTHING
    --    also absorbs canonical_name collisions from concurrent runs.
    WITH distinct_targets AS (
        SELECT DISTINCT ON (target_norm)
               target_norm, target_name, target_type, target_active
        FROM _auto_apply_batch
        ORDER BY target_norm, target_active DESC
    ),
    inserted AS (
        INSERT INTO public.canonical_entities
            (canonical_name, normalized_name, entity_type, is_active, notes)
        SELECT dt.target_name, dt.target_norm, dt.target_type, dt.target_active,
               'auto-created from LLM suggestion (auto_apply_entity_suggestions)'
        FROM distinct_targets dt
        WHERE NOT EXISTS (
            SELECT 1 FROM public.canonical_entities ce
            WHERE ce.normalized_name = dt.target_norm
        )
        ON CONFLICT DO NOTHING
        RETURNING id
    )
    SELECT count(*) INTO v_new_canonicals FROM inserted;

    -- 2. Map each raw variant to its canonical. A single statement means the
    --    entity_aliases recanonicalization trigger fires once for the whole
    --    batch. If an alias for the normalized key already exists (e.g. the
    --    self-alias trigger created it), keep it.
    INSERT INTO public.entity_aliases
        (canonical_id, alias, normalized_alias, source, approved_at)
    SELECT ce.id, b.raw_alias, b.normalized_alias, 'llm_auto', now()
    FROM _auto_apply_batch b
    JOIN public.canonical_entities ce ON ce.normalized_name = b.target_norm
    ON CONFLICT (normalized_alias) DO NOTHING;

    -- 3. Resolve the suggestions against whatever canonical the alias actually
    --    points to (covers the pre-existing-alias case above).
    WITH resolved AS (
        UPDATE public.entity_alias_suggestions s
        SET status = 'approved',
            resolved_canonical_id = ea.canonical_id,
            resolved_at = now()
        FROM _auto_apply_batch b
        JOIN public.entity_aliases ea ON ea.normalized_alias = b.normalized_alias
        WHERE s.id = b.id
        RETURNING s.id, b.suggested_is_non_entity
    )
    SELECT count(*), count(*) FILTER (WHERE suggested_is_non_entity)
    INTO v_applied, v_non_entity
    FROM resolved;

    -- 4. The competitors rollups are now stale; let the minutely metrics tick
    --    rebuild them (cheaper than a synchronous full rebuild per batch).
    IF v_applied > 0 THEN
        UPDATE public.mv_refresh_state
        SET force_refresh = true
        WHERE mv_name IN ('company_competitors_mv', 'company_competitors_by_location_mv');
    END IF;

    SELECT count(*) FILTER (WHERE
               (NOT suggested_is_non_entity
                AND suggested_canonical_name IS NOT NULL
                AND confidence >= p_min_confidence)
            OR (suggested_is_non_entity AND confidence >= p_min_confidence_non_entity)),
           count(*)
    INTO v_remaining_eligible, v_remaining_pending
    FROM public.entity_alias_suggestions
    WHERE status = 'pending' AND confidence IS NOT NULL;

    DROP TABLE IF EXISTS _auto_apply_batch;

    RETURN jsonb_build_object(
        'applied', v_applied,
        'new_canonicals', v_new_canonicals,
        'non_entity', v_non_entity,
        'remaining_eligible', v_remaining_eligible,
        'remaining_pending', v_remaining_pending
    );
END;
$$;

COMMENT ON FUNCTION public.auto_apply_entity_suggestions(numeric, numeric, integer) IS
    'Applies pending entity_alias_suggestions above a confidence threshold: creates canonicals, inserts aliases, marks suggestions approved, flags competitor rollups stale. Call repeatedly with small p_limit until applied = 0.';

REVOKE ALL ON FUNCTION public.auto_apply_entity_suggestions(numeric, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_apply_entity_suggestions(numeric, numeric, integer) FROM anon;
-- authenticated is allowed to call it, but the in-function guard restricts
-- execution to admins (the Data Cleanup tab) and service role (edge function).
GRANT EXECUTE ON FUNCTION public.auto_apply_entity_suggestions(numeric, numeric, integer)
    TO authenticated, service_role;
