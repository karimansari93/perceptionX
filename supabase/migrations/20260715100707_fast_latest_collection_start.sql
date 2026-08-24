-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715100707; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Helper: newest response *day* for an org (optionally one company) strictly
-- before a given day. One index probe per member company via the
-- (company_id, created_at) index — never scans response rows.
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

-- Rewrite: skip-scan from the newest day backwards instead of aggregating
-- every response row (the old version read 50k+ rows to find ~10 distinct
-- days and blew through the authenticated statement timeout on large orgs).
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

