-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260811075520; this file was
-- back-filled afterwards and therefore post-dates the deployment.

CREATE OR REPLACE FUNCTION public.get_company_responses_page(
  p_company_id uuid,
  p_excluded_models text[] DEFAULT '{}',
  p_since timestamptz DEFAULT NULL,
  p_before_tested_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(row_j), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', pr.id,
      'confirmed_prompt_id', pr.confirmed_prompt_id,
      'company_id', pr.company_id,
      'ai_model', pr.ai_model,
      'tested_at', pr.tested_at,
      'created_at', pr.created_at,
      'updated_at', pr.updated_at,
      'response_month', pr.response_month,
      'company_mentioned', pr.company_mentioned,
      'detected_competitors', CASE
        WHEN pr.canonicalized_at IS NOT NULL THEN pr.canonical_competitors
        ELSE public.canonicalize_competitor_list(pr.detected_competitors)
      END,
      'citations', CASE
        WHEN pr.canonicalized_at IS NOT NULL THEN pr.canonical_citations
        ELSE public.canonicalize_citations(pr.citations)
      END,
      'for_index', pr.for_index,
      'index_period', pr.index_period
    ) AS row_j
    FROM prompt_responses pr
    WHERE pr.company_id = p_company_id
      -- COALESCE bounds (not `param IS NULL OR ...`) so the generic plan keeps
      -- a tight (company_id, tested_at) index range: measured 37 ms/page vs
      -- 2.4 s with the OR form.
      AND pr.tested_at >= COALESCE(p_since, '-infinity'::timestamptz)
      AND pr.tested_at <= COALESCE(p_before_tested_at, 'infinity'::timestamptz)
      AND NOT (pr.ai_model = ANY (p_excluded_models))
      -- Keyset boundary: drop rows at the cursor's tested_at already returned.
      AND (
        p_before_tested_at IS NULL
        OR pr.tested_at < p_before_tested_at
        OR pr.id < p_before_id
      )
    ORDER BY pr.tested_at DESC, pr.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 2000)
  ) page;
$$;
