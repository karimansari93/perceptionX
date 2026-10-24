-- ============================================================================
-- Date-scoped recency rescore ("latest collection only")
-- ============================================================================
-- enqueue_recency_rescore processes *every* uncached URL for an org/company.
-- After a fresh data collection you usually only want to score the URLs that
-- the new responses introduced, not re-chew the entire backlog. This migration
-- adds an optional p_since cutoff: when set, the job only targets distinct
-- uncached URLs first cited by prompt_responses created on/after that instant.
--
-- Implementation: a date-scoped job snapshots its candidate URLs into
-- recency_rescore_job_urls at enqueue time (inside the same transaction, so the
-- worker never sees a half-populated job). The worker drains that fixed list
-- instead of the org-wide "all uncached" view. Non-scoped jobs (p_since NULL)
-- keep the exact old behaviour.

-- ----------------------------------------------------------------------------
-- 1. Optional collection-date cutoff on a job. NULL = whole backlog (old path).
-- ----------------------------------------------------------------------------
ALTER TABLE public.recency_rescore_jobs
  ADD COLUMN IF NOT EXISTS since_date TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Per-job candidate URL list. Only populated for date-scoped jobs. Gives the
--    worker a fixed set to drain so it never has to re-flatten citations by date
--    on every batch (prohibitively slow at 150k+ responses).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recency_rescore_job_urls (
    job_id UUID NOT NULL REFERENCES public.recency_rescore_jobs(id) ON DELETE CASCADE,
    url    TEXT NOT NULL
);

-- URLs can exceed btree's key limit, so the uniqueness guard hashes the URL
-- (same trick as organization_source_urls_mv).
CREATE UNIQUE INDEX IF NOT EXISTS idx_rescore_job_urls_job_url
    ON public.recency_rescore_job_urls(job_id, md5(url));

CREATE INDEX IF NOT EXISTS idx_rescore_job_urls_job
    ON public.recency_rescore_job_urls(job_id);

ALTER TABLE public.recency_rescore_job_urls ENABLE ROW LEVEL SECURITY;

-- Admins only, mirroring recency_rescore_jobs. The worker runs as service_role
-- and the enqueue RPC is SECURITY DEFINER, both of which bypass RLS.
CREATE POLICY "Admins can do everything with recency rescore job urls"
    ON public.recency_rescore_job_urls FOR ALL
    USING (is_admin());

GRANT SELECT, INSERT, DELETE ON public.recency_rescore_job_urls TO service_role;

COMMENT ON TABLE public.recency_rescore_job_urls IS
  'Candidate URL snapshot for date-scoped recency rescore jobs. Drained by the worker; cascade-deleted with the job.';

-- ----------------------------------------------------------------------------
-- 3. Status view over the candidate list (cache-joined) so the worker can pull
--    "next N still-uncached URLs for this job" with a simple filter.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_rescore_job_url_status AS
SELECT
  ju.job_id,
  ju.url,
  urc.recency_score,
  urc.extraction_method
FROM public.recency_rescore_job_urls ju
LEFT JOIN public.url_recency_cache urc ON urc.url = ju.url;

GRANT SELECT ON public.v_rescore_job_url_status TO service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 4. enqueue_recency_rescore gains an optional p_since. Drop the 2-arg version
--    first so PostgREST calls with only p_org/p_company stay unambiguous.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enqueue_recency_rescore(UUID, UUID);

CREATE OR REPLACE FUNCTION public.enqueue_recency_rescore(
    p_org     UUID,
    p_company UUID        DEFAULT NULL,
    p_since   TIMESTAMPTZ DEFAULT NULL
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
    -- Only one active job per org at a time, whatever its scope.
    SELECT id INTO v_existing
    FROM public.recency_rescore_jobs
    WHERE organization_id = p_org
      AND status IN ('queued', 'running')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- ---- Unscoped: original behaviour, all uncached URLs for org/company. ----
    IF p_since IS NULL THEN
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
    END IF;

    -- ---- Date-scoped: snapshot distinct uncached URLs first cited >= p_since. ----
    INSERT INTO public.recency_rescore_jobs (organization_id, company_id, since_date, total, created_by)
    VALUES (p_org, p_company, p_since, 0, auth.uid())
    RETURNING id INTO v_id;

    INSERT INTO public.recency_rescore_job_urls (job_id, url)
    SELECT v_id, u.url
    FROM (
        SELECT DISTINCT COALESCE(c->>'url', c->>'link') AS url
        FROM public.organization_companies oc
        JOIN public.prompt_responses pr ON pr.company_id = oc.company_id
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(pr.citations) = 'array' THEN pr.citations ELSE '[]'::jsonb END
        ) AS c
        WHERE oc.organization_id = p_org
          AND (p_company IS NULL OR oc.company_id = p_company)
          AND pr.created_at >= p_since
          AND pr.citations IS NOT NULL
    ) u
    LEFT JOIN public.url_recency_cache urc ON urc.url = u.url
    WHERE u.url IS NOT NULL
      AND u.url LIKE 'http%'
      AND urc.extraction_method IS NULL   -- only URLs not yet in cache
    ON CONFLICT (job_id, md5(url)) DO NOTHING;

    SELECT COUNT(*) INTO v_total
    FROM public.recency_rescore_job_urls
    WHERE job_id = v_id;

    UPDATE public.recency_rescore_jobs SET total = v_total WHERE id = v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_recency_rescore(UUID, UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.enqueue_recency_rescore(UUID, UUID, TIMESTAMPTZ) IS
  'Queue a recency rescore. p_since (optional) restricts the job to distinct uncached URLs first cited by responses created on/after that instant — used to score only the latest collection.';

NOTIFY pgrst, 'reload schema';
