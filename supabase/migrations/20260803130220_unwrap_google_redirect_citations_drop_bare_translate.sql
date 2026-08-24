-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260803130220; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- A bare translate.google.com/translate link (no u= target) is a Google UI
-- surface like /searchviewer, not a source — drop it too.
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
