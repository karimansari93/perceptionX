-- =============================================================================
-- Rebuild company_competitors_mv to aggregate through entity aliases.
--
-- Variants of the same company (e.g. "Hyundai", "Hyundai Motor India",
-- "Hyundai India") that share a canonical_entities row via entity_aliases now
-- collapse into a single bucket. Unmapped variants still appear as-is so
-- coverage gaps remain visible. Entities flagged is_active=false (the
-- "non-entity" suggestions like "No Competitors", "North America") are
-- dropped from the SOV list entirely.
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS public.company_competitors_mv;

CREATE MATERIALIZED VIEW public.company_competitors_mv AS
WITH raw AS (
    SELECT
        pr.company_id,
        public.normalize_entity_name(
            TRIM(BOTH FROM UNNEST(STRING_TO_ARRAY(pr.detected_competitors, ',')))
        ) AS normalized_alias
    FROM public.prompt_responses pr
    WHERE pr.company_id IS NOT NULL
      AND pr.for_index IS NOT TRUE
      AND pr.detected_competitors IS NOT NULL
      AND pr.detected_competitors <> ''
),
mapped AS (
    SELECT
        r.company_id,
        COALESCE(ce.canonical_name, INITCAP(r.normalized_alias)) AS competitor_name,
        ce.is_active AS is_active
    FROM raw r
    LEFT JOIN public.entity_aliases   ea ON ea.normalized_alias = r.normalized_alias
    LEFT JOIN public.canonical_entities ce ON ce.id = ea.canonical_id
    WHERE r.normalized_alias IS NOT NULL
      AND r.normalized_alias <> ''
      AND LENGTH(r.normalized_alias) > 1
      AND r.normalized_alias <> ALL (ARRAY[
          'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin',
          'monster', 'careerbuilder', 'ziprecruiter', 'dice', 'angelist',
          'wellfound', 'builtin', 'stackoverflow', 'github'
      ])
      AND r.normalized_alias <> ALL (ARRAY[
          'none', 'n/a', 'na', 'null', 'undefined'
      ])
      AND r.normalized_alias !~ '^[0-9]+$'
      AND r.normalized_alias ~ '[a-z0-9]'
      AND NOT (LENGTH(r.normalized_alias) <= 2 AND r.normalized_alias ~ '^[a-z]{1,2}$')
)
SELECT
    company_id,
    competitor_name,
    COUNT(*) AS mention_count
FROM mapped
WHERE is_active IS NOT FALSE
GROUP BY company_id, competitor_name;

CREATE UNIQUE INDEX company_competitors_mv_unique_idx
    ON public.company_competitors_mv (company_id, competitor_name);

CREATE INDEX company_competitors_mv_count_idx
    ON public.company_competitors_mv (company_id, mention_count DESC);


-- -----------------------------------------------------------------------------
-- Helper RPC to refresh the MV. Called from the admin UI after approving
-- suggestions or merging canonical entities so the SOV list updates promptly.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_company_competitors_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_competitors_mv;
EXCEPTION
    WHEN feature_not_supported THEN
        -- CONCURRENTLY requires the unique index to be valid; fall back to
        -- a blocking refresh if that's somehow not the case.
        REFRESH MATERIALIZED VIEW public.company_competitors_mv;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_company_competitors_mv() TO authenticated;
