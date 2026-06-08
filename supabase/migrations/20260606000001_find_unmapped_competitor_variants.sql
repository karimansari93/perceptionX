-- =============================================================================
-- find_unmapped_competitor_variants
--
-- Aggregation function the edge function uses to pick which raw competitor
-- variants to send to the LLM. Previously the function did a 5000-row sample
-- in JS and ranked from there — which could miss high-mention variants
-- spread across more responses than the sample window.
--
-- This RPC scans EVERY prompt_responses row for the given scope, counts each
-- distinct normalized variant, filters out anything already mapped (via
-- entity_aliases) or already queued (in entity_alias_suggestions), and
-- returns the top N by mention_count desc.
--
-- Scope precedence: p_company_id > p_organization_id > none (all rows).
-- =============================================================================

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
    -- Resolve scope to a concrete set of company_ids (NULL = no filter).
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
        -- Per (raw, norm) so the raw_alias returned to the LLM keeps its
        -- original casing (e.g. "Apple TV+"), not lowercase.
        SELECT raw, norm, COUNT(*)::int AS cnt
        FROM exploded
        WHERE norm IS NOT NULL AND norm <> ''
        GROUP BY raw, norm
    ),
    -- Pick the highest-frequency raw casing per normalized key so we don't
    -- emit duplicates that differ only in case/punctuation.
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
    WHERE ea.id  IS NULL          -- not already mapped
      AND sug.id IS NULL          -- not already queued
    ORDER BY d.total DESC, d.raw
    LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_unmapped_competitor_variants(int, uuid, uuid)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.find_unmapped_competitor_variants(int, uuid, uuid) IS
    'Top N raw competitor variants in scope (company_id > organization_id > all) that are not yet mapped or queued, ordered by mention frequency.';
