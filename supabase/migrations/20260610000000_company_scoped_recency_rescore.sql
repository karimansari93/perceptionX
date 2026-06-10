-- ============================================================================
-- Company-scoped recency rescore
-- ============================================================================
-- organization_source_urls_mv deduplicates to one row per (org, url), which
-- makes it impossible to run a recency cleanup for a single company inside a
-- large org (e.g. Netflix Animation Studios within Netflix). This migration
-- adds a company-grained URL MV + status view, lets recency_rescore_jobs
-- carry an optional company_id, and teaches enqueue_recency_rescore to
-- accept one.

-- ----------------------------------------------------------------------------
-- 1. Materialized View: distinct citation URL per (organization, company).
--    Same flattening as organization_source_urls_mv but keeps company_id.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS organization_company_source_urls_mv CASCADE;

CREATE MATERIALIZED VIEW organization_company_source_urls_mv AS
WITH citation_rows AS (
  SELECT
    oc.organization_id,
    pr.company_id,
    COALESCE(c->>'url', c->>'link') AS url
  FROM organization_companies oc
  JOIN prompt_responses pr ON pr.company_id = oc.company_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(pr.citations) = 'array' THEN pr.citations
      ELSE '[]'::jsonb
    END
  ) AS c
  WHERE pr.citations IS NOT NULL
)
SELECT DISTINCT
  organization_id,
  company_id,
  url
FROM citation_rows
WHERE url IS NOT NULL
  AND url LIKE 'http%';

-- md5(url) for the same btree key-size reason as organization_source_urls_mv.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_company_source_urls_unique
  ON organization_company_source_urls_mv(organization_id, company_id, md5(url));

CREATE INDEX IF NOT EXISTS idx_org_company_source_urls_company
  ON organization_company_source_urls_mv(company_id, md5(url));

GRANT SELECT ON organization_company_source_urls_mv TO authenticated;

COMMENT ON MATERIALIZED VIEW organization_company_source_urls_mv IS
  'Distinct citation URLs per (organization, company) — company-grained sibling of organization_source_urls_mv.';

-- ----------------------------------------------------------------------------
-- 2. View: per-company URL with cache status (company-grained sibling of
--    v_organization_url_status).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_company_url_status AS
SELECT
  csu.organization_id,
  csu.company_id,
  csu.url,
  urc.recency_score,
  urc.extraction_method,
  urc.publication_date,
  urc.last_checked_at
FROM organization_company_source_urls_mv csu
LEFT JOIN url_recency_cache urc ON urc.url = csu.url;

GRANT SELECT ON v_company_url_status TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Jobs can optionally target a single company. NULL = whole org (existing
--    behaviour). The one-active-job-per-org index stays: the cache is global
--    by URL, so two concurrent jobs in one org would race each other anyway.
-- ----------------------------------------------------------------------------
ALTER TABLE public.recency_rescore_jobs
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 4. enqueue_recency_rescore now takes an optional company. Drop the old
--    single-arg version first — leaving both overloads would make PostgREST
--    RPC calls with only p_org ambiguous.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enqueue_recency_rescore(UUID);

CREATE OR REPLACE FUNCTION public.enqueue_recency_rescore(
    p_org UUID,
    p_company UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing UUID;
    v_total    INT;
    v_id       UUID;
BEGIN
    -- Return the existing active job if one already exists for this org,
    -- whatever its scope — only one job per org runs at a time.
    SELECT id INTO v_existing
    FROM public.recency_rescore_jobs
    WHERE organization_id = p_org
      AND status IN ('queued', 'running')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Snapshot the count of missing URLs at enqueue time so the UI can show
    -- a meaningful progress denominator. The worker re-queries on each tick
    -- so the actual work is always against fresh data.
    IF p_company IS NULL THEN
        SELECT COUNT(*) INTO v_total
        FROM public.v_organization_url_status
        WHERE organization_id = p_org
          AND extraction_method IS NULL;
    ELSE
        SELECT COUNT(*) INTO v_total
        FROM public.v_company_url_status
        WHERE organization_id = p_org
          AND company_id = p_company
          AND extraction_method IS NULL;
    END IF;

    INSERT INTO public.recency_rescore_jobs (organization_id, company_id, total, created_by)
    VALUES (p_org, p_company, v_total, auth.uid())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_recency_rescore(UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Refresh function also refreshes the company-grained MV (after the org
--    one, before the coverage rollup — rollup only depends on the org MV).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_organization_recency_coverage()
RETURNS TABLE (
  view_name TEXT,
  refresh_started TIMESTAMPTZ,
  refresh_completed TIMESTAMPTZ,
  success BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_err TEXT;
BEGIN
  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
  END;

  v_start := NOW();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY organization_company_source_urls_mv;
    v_end := NOW();
    RETURN QUERY SELECT 'organization_company_source_urls_mv'::TEXT, v_start, v_end, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_end := NOW();
    v_err := SQLERRM;
    RETURN QUERY SELECT 'organization_company_source_urls_mv'::TEXT, v_start, v_end, FALSE, v_err;
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
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
