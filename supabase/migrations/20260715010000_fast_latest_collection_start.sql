-- ============================================================================
-- Fast latest-collection detection (skip-scan rewrite)
-- ============================================================================
-- get_latest_collection_start aggregated every prompt_responses row for the
-- org just to find ~10 distinct response days (2.3s for Ford's 52k rows) and
-- blew through the authenticated-role statement timeout when called from the
-- admin UI. Rewritten as a recursive skip-scan: hop backwards one response-day
-- at a time via index probes, so cost scales with the number of distinct days,
-- not the number of responses. Ford: 2,275ms -> 161ms.
--
-- The supporting index was created CONCURRENTLY on the live DB; the plain
-- statement here is for reproducibility on fresh environments.
CREATE INDEX IF NOT EXISTS idx_prompt_responses_company_created
  ON public.prompt_responses(company_id, created_at DESC);

-- Helper: newest response *day* for an org (optionally one company) strictly
-- before a given day. One index probe per member company.
CREATE OR REPLACE FUNCTION public._max_response_day_before(
    p_org     UUID,
    p_company UUID,
    p_before  DATE
)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT max(m.mx)::date
  FROM public.organization_companies oc
  CROSS JOIN LATERAL (
    SELECT max(pr.created_at) AS mx
    FROM public.prompt_responses pr
    WHERE pr.company_id = oc.company_id
      AND (p_before IS NULL OR pr.created_at < p_before::timestamptz)
  ) m
  WHERE oc.organization_id = p_org
    AND (p_company IS NULL OR oc.company_id = p_company);
$$;

-- Internal helper — keep it out of the PostgREST API surface.
REVOKE EXECUTE ON FUNCTION public._max_response_day_before(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_latest_collection_start(
    p_org     UUID,
    p_company UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH RECURSIVE days AS (
    SELECT public._max_response_day_before(p_org, p_company, NULL) AS d
    UNION ALL
    SELECT public._max_response_day_before(p_org, p_company, days.d)
    FROM days
    WHERE days.d IS NOT NULL
  ),
  seq AS (
    SELECT d, LAG(d) OVER (ORDER BY d DESC) AS newer
    FROM days
    WHERE d IS NOT NULL
  ),
  grp AS (
    SELECT d,
           SUM(CASE WHEN newer IS NOT NULL AND newer - d > 7 THEN 1 ELSE 0 END)
             OVER (ORDER BY d DESC) AS g
    FROM seq
  )
  SELECT MIN(d)::timestamptz FROM grp WHERE g = 0;
$$;

NOTIFY pgrst, 'reload schema';
