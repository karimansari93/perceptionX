-- =============================================================================
-- Automated competitor canonicalization (Data Cleanup tab)
--
-- Until now every grouping ("Toyota UK" -> "Toyota") waited for an admin to
-- click Approve. Audit on 2026-09-25 of the 2,300+ resolved suggestions:
--   * no suggestion was ever rejected;
--   * where admins changed a suggestion, it was almost always the same edit:
--     roll a regional / legal-entity / plant variant up to the parent brand;
--   * LLM agreement at confidence >= 0.95: map-to-existing 95%, new canonical
--     95%, non-entity 98%. Below 0.95 agreement drops (non-entity: 0-40%).
-- And the queue had silently stalled: find_unmapped_competitor_variants was
-- never applied to prod (20260606000001 missing from schema_migrations), so
-- the nightly job fell back to a stale 5,000-row sample and found nothing new
-- after 2026-08-05. ~25k distinct variants (~15% of competitor mentions) were
-- ungrouped.
--
-- This migration:
--   1. (Re)creates find_unmapped_competitor_variants.
--   2. Adds entity_alias_suggestions.auto_method. The edge function sets it
--      ('auto_rule' | 'auto_llm') on suggestions safe to apply without review.
--      Client names and their divisions are never marked (edge function
--      guard) and always stay in the manual queue.
--   3. apply_auto_canonicalization(): applies every marked pending suggestion
--      in one pass and recomputes prompt_responses.canonical_competitors with
--      ONE scan per run. The per-statement ILIKE recanonicalize triggers are
--      deferred for the duration (a 300-term ILIKE scan ran > 60 s).
--   4. Schedules both halves in the off-peak window (21:00-05:00 UTC):
--      suggest at :07, apply at :37. The suggest tick computes candidates in
--      SQL (no statement timeout under pg_cron; the full scan takes ~18 s,
--      too close to service_role's 20 s) and posts them to the edge function.
--
-- Undo: any auto-resolved row can be reopened from the Resolved section of
-- the Data Cleanup tab, exactly like a manual approval.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. find_unmapped_competitor_variants (identical to 20260606000001)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_unmapped_competitor_variants(
    p_limit           int     DEFAULT 50,
    p_organization_id uuid    DEFAULT NULL,
    p_company_id      uuid    DEFAULT NULL
)
RETURNS TABLE (
    raw_alias        text,
    normalized_alias text,
    mention_count    int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_ids uuid[];
BEGIN
    IF p_company_id IS NOT NULL THEN
        v_company_ids := ARRAY[p_company_id];
    ELSIF p_organization_id IS NOT NULL THEN
        SELECT array_agg(company_id)
          INTO v_company_ids
          FROM public.organization_companies
         WHERE organization_id = p_organization_id;

        IF v_company_ids IS NULL OR cardinality(v_company_ids) = 0 THEN
            RETURN;
        END IF;
    END IF;

    RETURN QUERY
    WITH exploded AS (
        SELECT
            TRIM(BOTH FROM UNNEST(STRING_TO_ARRAY(pr.detected_competitors, ','))) AS raw,
            public.normalize_entity_name(
                TRIM(BOTH FROM UNNEST(STRING_TO_ARRAY(pr.detected_competitors, ',')))
            ) AS norm
        FROM public.prompt_responses pr
        WHERE pr.for_index IS NOT TRUE
          AND pr.detected_competitors IS NOT NULL
          AND pr.detected_competitors <> ''
          AND (v_company_ids IS NULL OR pr.company_id = ANY (v_company_ids))
    ),
    counted AS (
        SELECT raw, norm, COUNT(*)::int AS cnt
        FROM exploded
        WHERE norm IS NOT NULL AND norm <> ''
        GROUP BY raw, norm
    ),
    deduped AS (
        SELECT DISTINCT ON (c.norm)
            c.raw, c.norm, SUM(c.cnt) OVER (PARTITION BY c.norm) AS total
        FROM counted c
        ORDER BY c.norm, c.cnt DESC
    )
    SELECT
        d.raw AS raw_alias,
        d.norm AS normalized_alias,
        d.total::int AS mention_count
    FROM deduped d
    LEFT JOIN public.entity_aliases ea
           ON ea.normalized_alias = d.norm
    LEFT JOIN public.entity_alias_suggestions sug
           ON sug.normalized_alias = d.norm
    WHERE ea.id  IS NULL
      AND sug.id IS NULL
    ORDER BY d.total DESC, d.raw
    LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_unmapped_competitor_variants(int, uuid, uuid)
    TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. auto_method marker
-- -----------------------------------------------------------------------------
ALTER TABLE public.entity_alias_suggestions
    ADD COLUMN IF NOT EXISTS auto_method text;

DO $$
BEGIN
    ALTER TABLE public.entity_alias_suggestions
        ADD CONSTRAINT entity_alias_suggestions_auto_method_check
        CHECK (auto_method IS NULL OR auto_method IN ('auto_rule', 'auto_llm'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.entity_alias_suggestions.auto_method IS
    'Set by suggest-entity-canonicalization when the suggestion is safe to apply without review (auto_rule = deterministic parent roll-up, auto_llm = high-confidence LLM decision). Pending + set = queued for apply_auto_canonicalization; approved + set = auto-resolved. Cleared when an admin acts on the row. Never set for client names or their divisions.';

CREATE INDEX IF NOT EXISTS idx_entity_alias_suggestions_auto_queue
    ON public.entity_alias_suggestions (mention_count DESC)
    WHERE status = 'pending' AND auto_method IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3a. Let a bulk writer defer the per-statement recanonicalize triggers.
--     Bodies are byte-identical to 20260610000000 apart from the guard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.entity_aliases_recanonicalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_terms text[];
BEGIN
    -- apply_auto_canonicalization recomputes affected rows itself in one pass.
    IF current_setting('perceptionx.defer_recanon', true) = 'on' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT alias) INTO v_terms FROM new_table;
    ELSIF TG_OP = 'UPDATE' THEN
        SELECT array_agg(DISTINCT alias) INTO v_terms
        FROM (SELECT alias FROM new_table UNION SELECT alias FROM old_table) u;
    ELSE
        SELECT array_agg(DISTINCT alias) INTO v_terms FROM old_table;
    END IF;

    PERFORM public.recanonicalize_competitors_for_terms(v_terms);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.canonical_entities_recanonicalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_terms text[];
BEGIN
    IF current_setting('perceptionx.defer_recanon', true) = 'on' THEN
        RETURN NULL;
    END IF;

    SELECT array_agg(DISTINCT ea.alias) INTO v_terms
    FROM new_table n
    JOIN old_table o ON o.id = n.id
    JOIN public.entity_aliases ea ON ea.canonical_id = n.id
    WHERE n.canonical_name IS DISTINCT FROM o.canonical_name
       OR n.is_active IS DISTINCT FROM o.is_active;

    PERFORM public.recanonicalize_competitors_for_terms(v_terms);
    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3b. apply_auto_canonicalization
-- -----------------------------------------------------------------------------
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
    SELECT array_agg(DISTINCT k) INTO v_norms
    FROM (
        SELECT normalized_alias AS k FROM _auto_canon WHERE canonical_id IS NOT NULL
        UNION
        SELECT canonical_norm FROM _auto_canon WHERE canonical_id IS NOT NULL
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

REVOKE ALL ON FUNCTION public.apply_auto_canonicalization(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_auto_canonicalization(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_auto_canonicalization(int) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Ticks + schedule
-- -----------------------------------------------------------------------------
-- Replaces the zero-arg version from 20260512100002.
DROP FUNCTION IF EXISTS public.suggest_entity_canonicalization_tick();

CREATE OR REPLACE FUNCTION public.suggest_entity_canonicalization_tick(p_batch int DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_project_url TEXT;
    v_service_key TEXT;
    v_request_id  BIGINT;
    v_variants    jsonb;
BEGIN
    SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_project_url IS NULL OR v_service_key IS NULL THEN
        RAISE NOTICE 'suggest_entity_canonicalization_tick: missing supabase_url or service_role_key in vault, skipping';
        RETURN jsonb_build_object('kicked', false, 'reason', 'missing_vault_secret');
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(v)), '[]'::jsonb) INTO v_variants
    FROM public.find_unmapped_competitor_variants(p_batch, NULL, NULL) v;

    IF jsonb_array_length(v_variants) = 0 THEN
        RETURN jsonb_build_object('kicked', false, 'reason', 'nothing_unmapped');
    END IF;

    SELECT net.http_post(
        url := v_project_url || '/functions/v1/suggest-entity-canonicalization',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_service_key,
            'Content-Type',  'application/json'
        ),
        body := jsonb_build_object('variants', v_variants, 'autoQueue', true),
        timeout_milliseconds := 300000
    ) INTO v_request_id;

    RETURN jsonb_build_object('kicked', true, 'variants', jsonb_array_length(v_variants), 'request_id', v_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_entity_canonicalization_tick(int) TO service_role;

DO $$
BEGIN
    PERFORM cron.unschedule('suggest-entity-canonicalization');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
    PERFORM cron.unschedule('apply-auto-canonicalization');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 8 runs a night x 300 variants: the highest-mention backlog clears in a few
-- nights, then runs no-op cheaply once nothing new is unmapped.
SELECT cron.schedule(
    'suggest-entity-canonicalization',
    '7 21-23,0-4 * * *',
    $cron$ SET statement_timeout TO 0; SELECT public.suggest_entity_canonicalization_tick(); $cron$
);

SELECT cron.schedule(
    'apply-auto-canonicalization',
    '37 21-23,0-4 * * *',
    $cron$ SET statement_timeout TO 0; SELECT public.apply_auto_canonicalization(); $cron$
);
