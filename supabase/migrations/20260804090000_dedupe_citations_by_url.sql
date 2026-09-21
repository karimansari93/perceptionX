-- ============================================================================
-- Dedupe citations by URL inside sanitize_citations
--
-- Why: Google's SERP payload cites the same page through several different
-- redirect wrappers (each carries its own &ved=/&psig= tracking), and the
-- collector deduped on the wrapper URL. Once the wrappers are unwrapped, those
-- collapse onto one destination — so a row can list the same page 2-5 times,
-- inflating that source's citation count. Measured on the last 30 days of
-- google-ai-mode/google-ai-overviews rows: 2,935 rows carrying 15,382
-- duplicate entries out of 288,251 (5.3%). The other models, whose citations
-- never went through a wrapper, have exactly zero duplicates — so deduping
-- here makes Google's rows agree with the rest of the pipeline rather than
-- changing an established convention.
--
-- Dedupe keeps the FIRST occurrence, so the title/snippet of the earliest
-- citation of a page wins and array order is otherwise preserved. Entries
-- without a url (inferred, domain-only) are never collapsed into each other.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sanitize_citations(input_citations jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT CASE
        WHEN input_citations IS NULL THEN NULL
        WHEN jsonb_typeof(input_citations) <> 'array' THEN input_citations
        ELSE COALESCE(
            (
                WITH exploded AS (
                    SELECT ord,
                           elem,
                           unwrapped,
                           CASE
                               WHEN jsonb_typeof(elem) <> 'object' OR elem->>'url' IS NULL THEN NULL
                               WHEN unwrapped IS DISTINCT FROM elem->>'url'
                                 OR coalesce(elem->>'domain', '') = ''
                                   THEN regexp_replace(
                                            split_part(split_part(regexp_replace(unwrapped, '^https?://', ''), '/', 1), '?', 1),
                                            '^www\.', ''
                                        )
                               ELSE elem->>'domain'
                           END AS new_domain
                    FROM jsonb_array_elements(input_citations) WITH ORDINALITY AS a(elem, ord),
                         LATERAL (SELECT public.unwrap_google_redirect_url(elem->>'url')) AS u(unwrapped)
                    -- Entries with no url are kept as-is; entries whose URL is
                    -- an unresolvable Google wrapper are dropped entirely.
                    WHERE elem->>'url' IS NULL
                       OR public.is_usable_citation_url(unwrapped)
                ),
                deduped AS (
                    -- One row per destination URL, first occurrence wins.
                    -- url-less entries key on their position so they survive.
                    SELECT DISTINCT ON (COALESCE(unwrapped, 'ord:' || ord))
                           ord, elem, unwrapped, new_domain
                    FROM exploded
                    ORDER BY COALESCE(unwrapped, 'ord:' || ord), ord
                )
                SELECT jsonb_agg(
                    CASE
                        -- Citations without a url object shape (bare strings,
                        -- inferred domain-only entries) pass through untouched.
                        WHEN new_domain IS NULL THEN elem
                        ELSE elem || jsonb_build_object(
                            'url', unwrapped,
                            'domain', new_domain,
                            -- Keep a real title (SERP anchor text); replace the
                            -- auto-generated "Source from google.com" placeholder.
                            'title', CASE
                                WHEN elem->>'title' IS NULL
                                  OR elem->>'title' = ''
                                  OR elem->>'title' ~ '^Source from '
                                    THEN 'Source from ' || new_domain
                                ELSE elem->>'title'
                            END
                        )
                    END
                    ORDER BY ord
                )
                FROM deduped
            ),
            '[]'::jsonb
        )
    END;
$$;

COMMENT ON FUNCTION public.sanitize_citations(jsonb) IS
    'Unwraps Google redirect URLs, re-derives domain/title from the real target, drops citations whose URL is an unresolvable Google wrapper, and dedupes by destination URL (first occurrence wins). Applied at write time by trg_prompt_responses_canonicalize.';
