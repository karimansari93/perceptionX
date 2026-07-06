-- =============================================================================
-- Rebuild company_top_sources_mv to canonicalize domains through source_aliases.
--
-- Same pattern as the company_competitors_mv rebuild: each raw citation domain
-- is normalized (strip protocol/www/path) and looked up via source_aliases →
-- canonical_sources. Variants pointing to the same canonical brand collapse
-- into one row; brands flagged is_active=false drop out.
--
-- Unmapped domains still appear as-is (keyed by the normalized domain) so the
-- Sources card stays honest about coverage gaps.
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS public.company_top_sources_mv CASCADE;

CREATE MATERIALIZED VIEW public.company_top_sources_mv AS
WITH unnested AS (
    SELECT
        pr.company_id,
        public.normalize_source_domain(c.value ->> 'domain') AS normalized_domain,
        LOWER(REGEXP_REPLACE(c.value ->> 'domain', '^www\.', '')) AS raw_domain,
        c.value ->> 'url' AS url
    FROM public.prompt_responses pr,
         LATERAL jsonb_array_elements(pr.citations) c(value)
    WHERE pr.company_id IS NOT NULL
      AND pr.for_index IS NOT TRUE
      AND jsonb_typeof(pr.citations) = 'array'
      AND c.value ->> 'domain' IS NOT NULL
      AND c.value ->> 'domain' <> ''
),
mapped AS (
    SELECT
        u.company_id,
        -- Display name: canonical brand if mapped, otherwise the normalized domain
        COALESCE(cs.canonical_name, u.normalized_domain) AS domain,
        u.url,
        cs.is_active
    FROM unnested u
    LEFT JOIN public.source_aliases sa
           ON sa.normalized_alias_domain = u.normalized_domain
    LEFT JOIN public.canonical_sources cs
           ON cs.id = sa.canonical_id
    WHERE u.normalized_domain IS NOT NULL
      AND u.normalized_domain <> ''
)
SELECT
    company_id,
    domain,
    MIN(url) AS sample_url,
    COUNT(*) AS citation_count,
    ROUND(
        (COUNT(*)::numeric / SUM(COUNT(*)) OVER (PARTITION BY company_id)) * 100,
        1
    ) AS pct_of_total
FROM mapped
WHERE is_active IS NOT FALSE
GROUP BY company_id, domain;

CREATE UNIQUE INDEX company_top_sources_mv_unique_idx
    ON public.company_top_sources_mv (company_id, domain);

CREATE INDEX company_top_sources_mv_count_idx
    ON public.company_top_sources_mv (company_id, citation_count DESC);
