-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260225064514; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- 1. Fix function search_path warnings
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_ranked_entity(p_company_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  SELECT COALESCE(
    (
      SELECT entity_type != 'source'
      FROM public.company_entity_classifications
      WHERE company_name = lower(trim(p_company_name))
      LIMIT 1
    ),
    true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_source_entity(p_company_name text, p_canonical_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_entity_classifications ec
    WHERE ec.entity_type = 'source'
      AND (
        ec.company_name = lower(trim(p_company_name))
        OR ec.company_name = lower(trim(p_canonical_name))
        OR lower(trim(p_company_name)) LIKE (ec.company_name || '%')
        OR lower(trim(p_canonical_name)) LIKE (ec.company_name || '%')
      )
  );
$function$;

-- ============================================================
-- 2. Revoke direct API access to materialized views
--    (data should only flow through the secured views)
-- ============================================================

REVOKE SELECT ON public.company_competitors_mv FROM anon, authenticated;
REVOKE SELECT ON public.company_sentiment_scores_mv FROM anon, authenticated;
REVOKE SELECT ON public.company_relevance_scores_mv FROM anon, authenticated;
REVOKE SELECT ON public.company_overview_metrics_mv FROM anon, authenticated;
REVOKE SELECT ON public.company_llm_rankings_mv FROM anon, authenticated;
REVOKE SELECT ON public.company_top_sources_mv FROM anon, authenticated;
REVOKE SELECT ON public.rankings_overview FROM anon, authenticated;
REVOKE SELECT ON public.rankings_historical FROM anon, authenticated;

