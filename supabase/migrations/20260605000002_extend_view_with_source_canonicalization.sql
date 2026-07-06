-- =============================================================================
-- Extend prompt_responses_canonical to also rewrite citation domains.
--
-- Each citation in the citations JSONB array gets two new fields:
--   * canonical_domain — domain_root from canonical_sources (when matched)
--   * canonical_name   — display name (e.g. "Glassdoor" for glassdoor.ie)
--
-- The original `domain` and `url` are preserved so the click-through still works.
-- The dashboard's Sources card reads canonical_name when present, falls back to
-- domain otherwise — so unmapped sources stay visible.
-- =============================================================================

-- Helper that rewrites a single citations JSONB array.
CREATE OR REPLACE FUNCTION public.canonicalize_citations(input_citations jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN input_citations IS NULL THEN NULL
        WHEN jsonb_typeof(input_citations) <> 'array' THEN input_citations
        ELSE COALESCE(
            (
                SELECT jsonb_agg(
                    -- For each citation object, merge in canonical_domain + canonical_name.
                    elem || jsonb_build_object(
                        'canonical_domain',
                            cs.domain_root,
                        'canonical_name',
                            COALESCE(cs.canonical_name, elem->>'domain')
                    )
                )
                FROM jsonb_array_elements(input_citations) AS elem
                LEFT JOIN public.source_aliases sa
                       ON sa.normalized_alias_domain = public.normalize_source_domain(elem->>'domain')
                LEFT JOIN public.canonical_sources cs
                       ON cs.id = sa.canonical_id
                      AND cs.is_active IS TRUE
            ),
            '[]'::jsonb
        )
    END;
$$;

GRANT EXECUTE ON FUNCTION public.canonicalize_citations(jsonb)
    TO authenticated, service_role;


-- Re-create the canonical view with citations also canonicalized.
CREATE OR REPLACE VIEW public.prompt_responses_canonical AS
SELECT
    pr.id,
    pr.confirmed_prompt_id,
    pr.ai_model,
    pr.response_text,
    public.canonicalize_citations(pr.citations) AS citations,
    pr.company_mentioned,
    pr.created_at,
    pr.updated_at,
    pr.tested_at,
    pr.company_id,
    pr.created_by,
    pr.for_index,
    pr.index_period,
    pr.response_month,
    pr.collection_cycle,
    public.canonicalize_competitor_list(pr.detected_competitors)
        AS detected_competitors
FROM public.prompt_responses pr;
