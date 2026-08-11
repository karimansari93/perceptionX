-- Slim keyset pagination for the dashboard's response stream.
--
-- The previous shape — prompt_responses_canonical with an embedded
-- confirmed_prompts!inner(...) join, OFFSET pagination, and count:'exact' on
-- the first page — measured 73 MB per full load on an 18-profile brand scope:
-- every row re-shipped its prompt's full text (the same ~4K prompts duplicated
-- across ~24K rows), OFFSET pages re-walked and re-detoasted all earlier rows
-- (793 ms server-side per 1000-row page), and the exact count scanned the
-- whole range once more.
--
-- This function returns the same canonical row shape MINUS the embedded
-- prompt (the client already loads all scope prompts once via
-- get_scope_prompts and stitches by confirmed_prompt_id), paged by a
-- (tested_at, id) keyset that walks the (company_id, tested_at DESC, id DESC)
-- index directly — every page costs the same regardless of depth.
--
-- SECURITY INVOKER: prompt_responses RLS (hoisted org-membership policy)
-- applies unchanged.

CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_tested_id
  ON public.prompt_responses (company_id, tested_at DESC, id DESC)
  WHERE company_id IS NOT NULL;

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

REVOKE ALL ON FUNCTION public.get_company_responses_page(uuid, text[], timestamptz, timestamptz, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_responses_page(uuid, text[], timestamptz, timestamptz, uuid, int) TO authenticated, service_role;

-- Advisor hygiene: rankings_historical carried two identical unique indexes.
DROP INDEX IF EXISTS public.idx_rankings_historical_unique;
