-- =============================================================================
-- apply_auto_canonicalization: recompute only rows that can change
--
-- First production runs (2026-09-25) recomputed prompt_responses rows for
-- every touched normalized key including existing parent canonicals, e.g.
-- every "Toyota" mention when "Toyota Peru" was grouped: 66,374 rows and
-- ~2 minutes for 219 groupings. Those rows cannot change (the parent is
-- already canonical), so only variant aliases and canonicals created in the
-- run are recomputed now. Otherwise identical to 20260925120000.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_auto_canonicalization(p_limit int DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_ids   uuid[];
    v_norms     text[];
    v_applied   int := 0;
    v_skipped   int := 0;
    v_recanon   int := 0;
BEGIN
    PERFORM public.resolve_orphan_canonicalization_suggestions();

    -- Transaction-local: the triggers see it only inside this call.
    PERFORM set_config('perceptionx.defer_recanon', 'on', true);

    DROP TABLE IF EXISTS pg_temp._auto_canon;
    CREATE TEMP TABLE _auto_canon ON COMMIT DROP AS
    SELECT
        s.id                                             AS suggestion_id,
        s.raw_alias,
        s.normalized_alias,
        s.auto_method,
        s.suggested_is_non_entity                        AS is_non_entity,
        -- Non-entities get their own inactive canonical named after the raw
        -- text, the same shape the admin approve flow produces.
        CASE WHEN s.suggested_is_non_entity THEN s.raw_alias
             ELSE btrim(s.suggested_canonical_name) END  AS canonical_name,
        public.normalize_entity_name(
            CASE WHEN s.suggested_is_non_entity THEN s.raw_alias
                 ELSE s.suggested_canonical_name END)    AS canonical_norm,
        CASE WHEN s.suggested_is_non_entity THEN 'non_entity'
             ELSE COALESCE(NULLIF(s.suggested_entity_type, 'non_entity'), 'other')
        END                                              AS entity_type,
        NULL::uuid                                       AS canonical_id
    FROM public.entity_alias_suggestions s
    WHERE s.status = 'pending'
      AND s.auto_method IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.entity_aliases ea
          WHERE ea.normalized_alias = s.normalized_alias)
    ORDER BY s.mention_count DESC
    LIMIT GREATEST(p_limit, 1);

    -- New canonicals are created inactive so the row-level self-alias trigger
    -- stays quiet; they are activated after the bulk alias insert below.
    WITH ins AS (
        INSERT INTO public.canonical_entities (canonical_name, normalized_name, entity_type, is_active)
        SELECT DISTINCT ON (a.canonical_norm)
               a.canonical_name, a.canonical_norm, a.entity_type, false
        FROM _auto_canon a
        WHERE a.canonical_norm IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.canonical_entities ce
              WHERE ce.normalized_name = a.canonical_norm)
        ORDER BY a.canonical_norm, a.canonical_name
        ON CONFLICT DO NOTHING
        RETURNING id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_new_ids FROM ins;

    -- Resolve targets. A real company never lands on an inactive / non-entity
    -- canonical, and a non-entity never lands on a real one.
    UPDATE _auto_canon a
    SET canonical_id = ce.id
    FROM public.canonical_entities ce
    WHERE ce.normalized_name = a.canonical_norm
      AND (
            (a.is_non_entity AND ce.entity_type = 'non_entity')
         OR (NOT a.is_non_entity
             AND ce.entity_type IS DISTINCT FROM 'non_entity'
             AND (ce.is_active OR ce.id = ANY (v_new_ids)))
      );

    -- Anything that did not resolve cleanly goes back to the manual queue.
    UPDATE public.entity_alias_suggestions s
    SET auto_method = NULL
    FROM _auto_canon a
    WHERE a.suggestion_id = s.id AND a.canonical_id IS NULL;
    GET DIAGNOSTICS v_skipped = ROW_COUNT;

    -- One statement for every alias (variants + self-aliases of new canonicals).
    INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
    SELECT DISTINCT ON (x.normalized_alias)
           x.canonical_id, x.alias, x.normalized_alias, x.source, now()
    FROM (
        SELECT a.canonical_id, a.raw_alias AS alias, a.normalized_alias, a.auto_method AS source, 0 AS pri
        FROM _auto_canon a
        WHERE a.canonical_id IS NOT NULL
        UNION ALL
        SELECT ce.id, ce.canonical_name, ce.normalized_name, 'auto_self', 1
        FROM public.canonical_entities ce
        WHERE ce.id = ANY (v_new_ids)
          AND ce.entity_type IS DISTINCT FROM 'non_entity'
          AND EXISTS (SELECT 1 FROM _auto_canon a WHERE a.canonical_id = ce.id)
    ) x
    ORDER BY x.normalized_alias, x.pri
    ON CONFLICT (normalized_alias) DO NOTHING;

    UPDATE public.canonical_entities
    SET is_active = true
    WHERE id = ANY (v_new_ids)
      AND entity_type IS DISTINCT FROM 'non_entity';

    -- Drop canonicals created this run that nothing ended up pointing at
    -- (e.g. every row targeting them was skipped).
    DELETE FROM public.canonical_entities ce
    WHERE ce.id = ANY (v_new_ids)
      AND NOT EXISTS (SELECT 1 FROM _auto_canon a WHERE a.canonical_id = ce.id);

    UPDATE public.entity_alias_suggestions s
    SET status = 'approved',
        resolved_canonical_id = a.canonical_id,
        resolved_at = now()
    FROM _auto_canon a
    WHERE a.suggestion_id = s.id
      AND a.canonical_id IS NOT NULL;
    GET DIAGNOSTICS v_applied = ROW_COUNT;

    -- One scan of prompt_responses for every touched normalized key. Exact
    -- normalized-token match is what canonicalize_competitor_list joins on.
    -- Only rows containing a newly aliased token can change: the variants
    -- themselves plus the names of canonicals created in this run. Existing
    -- parents ("toyota") are already canonical wherever they appear, so
    -- including them rewrote ~66k unchanged rows per run.
    SELECT array_agg(DISTINCT k) INTO v_norms
    FROM (
        SELECT normalized_alias AS k FROM _auto_canon WHERE canonical_id IS NOT NULL
        UNION
        SELECT ce.normalized_name FROM public.canonical_entities ce WHERE ce.id = ANY (v_new_ids)
    ) t;

    IF v_norms IS NOT NULL THEN
        UPDATE public.prompt_responses pr
        SET canonical_competitors = public.canonicalize_competitor_list(pr.detected_competitors),
            canonicalized_at      = now()
        WHERE pr.detected_competitors IS NOT NULL
          AND pr.detected_competitors <> ''
          AND EXISTS (
              SELECT 1
              FROM unnest(string_to_array(pr.detected_competitors, ',')) AS v(part)
              WHERE public.normalize_entity_name(btrim(v.part)) = ANY (v_norms)
          );
        GET DIAGNOSTICS v_recanon = ROW_COUNT;
    END IF;

    PERFORM set_config('perceptionx.defer_recanon', 'off', true);

    RETURN jsonb_build_object(
        'applied', v_applied,
        'returned_to_manual', v_skipped,
        'new_canonicals', (SELECT count(*) FROM public.canonical_entities WHERE id = ANY (v_new_ids)),
        'responses_recanonicalized', v_recanon
    );
END;
$$;

