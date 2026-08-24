-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260508075030; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Drop the unusable expression index — CONCURRENTLY refresh requires
-- a plain-column unique index, but the URL column is too long for
-- one. Instead, refresh this MV non-concurrently (briefly locks
-- reads for the duration of the rebuild). Acceptable since it's an
-- admin-only diagnostic surface.

DROP INDEX IF EXISTS public.organization_source_urls_mv_unique_idx;

CREATE OR REPLACE FUNCTION public.refresh_organization_recency_coverage()
RETURNS TABLE(view_name text, refresh_started timestamp with time zone, refresh_completed timestamp with time zone, success boolean, error_message text)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_err TEXT;
BEGIN
  v_start := NOW();
  BEGIN
    -- Non-concurrent because URLs exceed btree's row-size limit so we
    -- can't build the plain-column unique index CONCURRENTLY needs.
    REFRESH MATERIALIZED VIEW organization_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_recency_coverage_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_recency_coverage_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_recency_coverage_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;
END;
$function$;
