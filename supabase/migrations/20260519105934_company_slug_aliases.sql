-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260519105934; this file was
-- back-filled afterwards and therefore post-dates the deployment.


CREATE TABLE IF NOT EXISTS public.company_slug_aliases (
  old_slug       text PRIMARY KEY,
  canonical_slug text        NOT NULL,
  canonical_name text        NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_slug_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_slug_aliases_read ON public.company_slug_aliases;
CREATE POLICY company_slug_aliases_read ON public.company_slug_aliases
  FOR SELECT USING (true);

GRANT SELECT ON public.company_slug_aliases TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rebuild_slug_aliases()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  TRUNCATE public.company_slug_aliases;

  INSERT INTO public.company_slug_aliases (old_slug, canonical_slug, canonical_name)
  SELECT DISTINCT ON (old_slug)
         old_slug,
         cs.slug          AS canonical_slug,
         cs.canonical_name AS canonical_name
  FROM (
    SELECT slugify_name(ccn.variant_name) AS old_slug,
           ccn.canonical_name
    FROM company_canonical_names ccn
    WHERE slugify_name(ccn.variant_name) <> ''
  ) v
  JOIN company_snapshots cs
    ON lower(cs.canonical_name) = lower(v.canonical_name)
  WHERE v.old_slug <> cs.slug
    AND v.old_slug NOT IN (SELECT slug FROM company_snapshots)
  ORDER BY old_slug, cs.slug;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.pipeline_freshness (object, refreshed_at, row_count, detail)
  VALUES ('company_slug_aliases', now(), v_count, 'rebuild_slug_aliases')
  ON CONFLICT (object) DO UPDATE
    SET refreshed_at = excluded.refreshed_at,
        row_count    = excluded.row_count,
        detail       = excluded.detail;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rebuild_slug_aliases() TO service_role;

