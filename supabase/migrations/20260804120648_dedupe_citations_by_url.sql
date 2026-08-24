-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260804120648; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Dedupe citations by destination URL inside sanitize_citations.
-- Google cites one page through several redirect wrappers (each with its own
-- &ved=/&psig=), and the collector deduped on the wrapper. Unwrapped, those
-- collapse onto one destination, so a row could list the same page 2-5 times
-- and inflate that source's count. Models whose citations never went through a
-- wrapper have zero duplicates, so this makes Google agree with the rest of
-- the pipeline. First occurrence wins; url-less entries never collapse.
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
                    WHERE elem->>'url' IS NULL
                       OR public.is_usable_citation_url(unwrapped)
                ),
                deduped AS (
                    SELECT DISTINCT ON (COALESCE(unwrapped, 'ord:' || ord))
                           ord, elem, unwrapped, new_domain
                    FROM exploded
                    ORDER BY COALESCE(unwrapped, 'ord:' || ord), ord
                )
                SELECT jsonb_agg(
                    CASE
                        WHEN new_domain IS NULL THEN elem
                        ELSE elem || jsonb_build_object(
                            'url', unwrapped,
                            'domain', new_domain,
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
