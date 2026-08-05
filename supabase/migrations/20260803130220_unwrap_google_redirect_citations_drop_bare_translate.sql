-- A bare translate.google.com/translate link (no u= target) is a Google UI
-- surface like /searchviewer, not a source — drop it too.
--
-- Folded into 20260803125851's definition as well, so this is a no-op on a
-- database built from scratch; it exists because that migration was already
-- applied when the case turned up in production data.
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
       AND p_url !~* '^https?://([a-z0-9-]+\.)*google\.[a-z.]+/(url|imgres|search|searchviewer|viewer|translate|async|sorry|preferences|setprefs)(/|\?|$)';
$$;
