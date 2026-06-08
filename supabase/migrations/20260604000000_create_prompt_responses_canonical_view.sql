-- =============================================================================
-- prompt_responses_canonical view
--
-- Drop-in replacement for prompt_responses where detected_competitors has been
-- canonicalized via entity_aliases → canonical_entities:
--   * Each comma-separated variant is replaced by its canonical_name.
--   * Variants that map to a non-active canonical (the "non-entity" rows the
--     admin canonicalization tab marks as such) are dropped entirely.
--   * Unmapped variants keep their original spelling so coverage gaps stay
--     visible.
--   * Duplicate canonicals within a single response collapse to one entry
--     (so "Amazon, Amazon Prime Video, AWS" becomes "Amazon").
--
-- The dashboard switches its fetch from prompt_responses to this view. No
-- client-side alias map. No race condition. Both the Overview Competitors
-- card and the Competitors tab consume the same canonicalized strings, so
-- their numbers agree by construction.
--
-- Same shape as prompt_responses (column-wise), so SELECT * works.
-- =============================================================================

-- Helper function that canonicalizes a single comma-separated detected_competitors
-- string. Extracted so the view stays readable and the same logic can be reused
-- elsewhere (e.g. an MV refresh).
CREATE OR REPLACE FUNCTION public.canonicalize_competitor_list(input_list text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT NULLIF(STRING_AGG(canonicalized, ', '), '')
    FROM (
        SELECT DISTINCT COALESCE(ce.canonical_name, TRIM(BOTH FROM v))
               AS canonicalized
        FROM UNNEST(STRING_TO_ARRAY(input_list, ',')) AS v
        LEFT JOIN public.entity_aliases ea
               ON ea.normalized_alias = public.normalize_entity_name(TRIM(BOTH FROM v))
        LEFT JOIN public.canonical_entities ce
               ON ce.id = ea.canonical_id
        WHERE TRIM(BOTH FROM v) <> ''
          AND COALESCE(ce.is_active, true) IS TRUE
    ) s;
$$;

-- The view exposes every column from prompt_responses (via `pr.*`) but replaces
-- detected_competitors with the canonicalized output. Listing columns
-- explicitly keeps the view stable across future prompt_responses schema
-- changes — when a new column lands, add it above the override.
-- Mirrors every column on prompt_responses (as of 2026-06) except
-- detected_competitors, which we override with the canonicalized output.
-- If the schema gains a column later, add it here so the dashboard still sees it.
CREATE OR REPLACE VIEW public.prompt_responses_canonical AS
SELECT
    pr.id,
    pr.confirmed_prompt_id,
    pr.ai_model,
    pr.response_text,
    pr.citations,
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
    -- Canonicalized detected_competitors. Rows whose variants all collapse to
    -- non-entities surface as NULL (matches "no competitors found" handling
    -- already in the dashboard).
    public.canonicalize_competitor_list(pr.detected_competitors)
        AS detected_competitors
FROM public.prompt_responses pr;

-- If prompt_responses gains columns later, add them above the
-- detected_competitors SELECT.

GRANT EXECUTE ON FUNCTION public.canonicalize_competitor_list(text)
    TO authenticated, service_role;
GRANT SELECT ON public.prompt_responses_canonical TO authenticated, service_role;

COMMENT ON VIEW public.prompt_responses_canonical IS
    'Drop-in replacement for prompt_responses with detected_competitors canonicalized via entity_aliases. Dashboard should fetch from here, not prompt_responses, so canonicalization is enforced at the data layer (no client-side alias map needed).';
