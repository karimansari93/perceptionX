-- ============================================================================
-- Unwrap Google redirect URLs in prompt_responses.citations
--
-- Why: Google's SERP payloads (SerpAPI and Scrapingdog alike) hand back links
-- that point at google.com rather than at the source itself:
--
--   https://www.google.com/url?sa=i&...&url=<real>&ved=...   (image/result redirect)
--   https://translate.google.com/translate?u=<real>&hl=es    (localized markets)
--   https://www.google.com/imgres?imgurl=<img>&imgrefurl=<real>
--
-- Stored verbatim, those made google.com the app's most-cited "source"
-- (~17k citations across ~2.8k responses) and broke recency scoring, because
-- url_recency_cache can never match the wrapper.
--
-- The edge functions now unwrap before writing (_shared/citation-extraction.ts
-- + _shared/google-serp.ts). This migration is the backstop that makes the
-- guarantee hold for ANY writer: the existing BEFORE INSERT/UPDATE
-- canonicalization trigger now sanitizes citations first, so a wrapper cannot
-- land in the table even if a future code path forgets. It also backfills the
-- rows already stored.
--
-- Wrappers with no recoverable destination (google.com/url?url=CAES<opaque>,
-- google.com/searchviewer, /search) are Google UI surfaces rather than
-- sources — those citations are dropped instead of being kept as google.com.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Percent-decoding helper (Postgres has no built-in urldecode)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.percent_decode(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
    v_result text;
BEGIN
    IF p_text IS NULL OR p_text = '' THEN
        RETURN p_text;
    END IF;

    -- Rebuild the string byte-by-byte: %XX escapes become their byte value,
    -- every other character contributes its UTF-8 bytes, then decode the lot
    -- as UTF-8 so multi-byte sequences (%C3%A9 -> é) survive. '+' means space
    -- in a query string, matching JS URLSearchParams.get().
    SELECT convert_from(
               decode(
                   string_agg(
                       CASE
                           WHEN left(m[1], 1) = '%' THEN substring(m[1] from 2 for 2)
                           WHEN m[1] = '+' THEN '20'
                           ELSE encode(convert_to(m[1], 'UTF8'), 'hex')
                       END,
                       ''
                   ),
                   'hex'
               ),
               'UTF8'
           )
      INTO v_result
      FROM regexp_matches(p_text, '%[0-9a-fA-F]{2}|[\s\S]', 'g') AS t(m);

    RETURN coalesce(v_result, p_text);
EXCEPTION WHEN others THEN
    -- e.g. escapes that aren't valid UTF-8 (%E9 from a latin-1 URL). Better to
    -- keep the raw value than to fail a citation write.
    RETURN p_text;
END;
$$;

COMMENT ON FUNCTION public.percent_decode(text) IS
    'URL percent-decoding (UTF-8 aware, + means space). Used to unwrap Google redirect URLs.';

-- ---------------------------------------------------------------------------
-- 2. Unwrap a Google redirect URL to the page it points at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unwrap_google_redirect_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
    v_current text := btrim(p_url);
    v_target  text;
BEGIN
    IF v_current IS NULL OR v_current = '' THEN
        RETURN p_url;
    END IF;

    -- Wrappers occasionally nest (an image redirect around a translate link);
    -- a chain longer than 3 is pathological, not real data.
    FOR _i IN 1..3 LOOP
        v_target := NULL;

        IF v_current ~* '^https?://translate\.google(usercontent)?\.[a-z.]+/' THEN
            v_target := substring(v_current from '[?&]u=([^&#]+)');
        ELSIF v_current ~* '^https?://([a-z0-9-]+\.)*google\.[a-z.]+/url\?' THEN
            v_target := coalesce(
                substring(v_current from '[?&]url=([^&#]+)'),
                substring(v_current from '[?&]q=([^&#]+)')
            );
        ELSIF v_current ~* '^https?://([a-z0-9-]+\.)*google\.[a-z.]+/imgres\?' THEN
            v_target := coalesce(
                substring(v_current from '[?&]imgrefurl=([^&#]+)'),
                substring(v_current from '[?&]imgurl=([^&#]+)')
            );
        END IF;

        EXIT WHEN v_target IS NULL;

        v_target := public.percent_decode(v_target);
        -- Not an http(s) destination (opaque CAES… token, about:invalid): the
        -- wrapper has no source behind it. Leave it as-is; step 3 rejects it.
        EXIT WHEN v_target !~* '^https?://';

        -- Drop Google's #:~:text= scroll-to-text fragment.
        v_target := split_part(v_target, '#:~:text=', 1);
        EXIT WHEN v_target = v_current;

        v_current := v_target;
    END LOOP;

    RETURN v_current;
END;
$$;

COMMENT ON FUNCTION public.unwrap_google_redirect_url(text) IS
    'Resolves google.com/url, /imgres and translate.google.com wrappers to the real source URL. Returns the input unchanged when it is not a wrapper (or carries no http target).';

-- ---------------------------------------------------------------------------
-- 3. Is a URL worth storing as a citation?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_usable_citation_url(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT p_url IS NOT NULL
       AND p_url ~* '^https?://'
       -- Google-hosted search-UI surfaces: an unwrapped wrapper, a results
       -- page, or a knowledge-panel viewer. None of them is a source.
       AND p_url !~* '^https?://([a-z0-9-]+\.)*google\.[a-z.]+/(url|imgres|search|searchviewer|viewer|async|sorry|preferences|setprefs)(/|\?|$)';
$$;

COMMENT ON FUNCTION public.is_usable_citation_url(text) IS
    'False for non-http URLs and for Google search-UI surfaces (unwrappable redirects, /search, /searchviewer) that would otherwise be counted as google.com sources.';

-- ---------------------------------------------------------------------------
-- 4. Sanitize a citations array
-- ---------------------------------------------------------------------------
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
                )
                FROM (
                    SELECT elem,
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
                    FROM jsonb_array_elements(input_citations) AS elem,
                         LATERAL (SELECT public.unwrap_google_redirect_url(elem->>'url')) AS u(unwrapped)
                    -- Entries with no url are kept as-is; entries whose URL is
                    -- an unresolvable Google wrapper are dropped entirely.
                    WHERE elem->>'url' IS NULL
                       OR public.is_usable_citation_url(unwrapped)
                ) AS kept
            ),
            '[]'::jsonb
        )
    END;
$$;

COMMENT ON FUNCTION public.sanitize_citations(jsonb) IS
    'Unwraps Google redirect URLs, re-derives domain/title from the real target, and drops citations whose URL is an unresolvable Google wrapper. Applied at write time by trg_prompt_responses_canonicalize.';

GRANT EXECUTE ON FUNCTION public.percent_decode(text),
                          public.unwrap_google_redirect_url(text),
                          public.is_usable_citation_url(text),
                          public.sanitize_citations(jsonb)
    TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Enforce at write time — no writer can store a wrapper again
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prompt_responses_canonicalize_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
    -- Sanitize first so the stored citations AND the canonical copy derived
    -- from them are both free of Google redirect wrappers.
    NEW.citations             := public.sanitize_citations(NEW.citations);
    NEW.canonical_citations   := public.canonicalize_citations(NEW.citations);
    NEW.canonical_competitors := public.canonicalize_competitor_list(NEW.detected_competitors);
    NEW.canonicalized_at      := now();
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Backfill rows already holding wrappers (~3k of 206k)
-- ---------------------------------------------------------------------------
-- Single pass: the wrapper predicate needs a sequential scan either way, and
-- only ~3k of 206k rows match, so batching would just re-scan the table. The
-- BEFORE trigger re-runs sanitize_citations on write (it is idempotent) and
-- refreshes canonical_citations for the touched rows.
DO $backfill$
DECLARE
    v_updated integer;
BEGIN
    UPDATE public.prompt_responses pr
    SET citations = public.sanitize_citations(pr.citations)
    WHERE (
            pr.citations::text ~ 'google\.[a-z.]+/(url\?|imgres\?|search\?|searchviewer|viewer/place)'
         OR pr.citations::text ~ 'translate\.google(usercontent)?\.[a-z.]+/'
          )
      AND public.sanitize_citations(pr.citations) IS DISTINCT FROM pr.citations;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'unwrap_google_redirect_citations: sanitized % prompt_responses rows', v_updated;
END;
$backfill$;
