-- ============================================================================
-- Latest-collection detection for date-scoped recency rescores
-- ============================================================================
-- The admin UI lets you rescore "latest collection only" without picking a
-- date by hand. Data collections arrive in day-bursts separated by weeks, so
-- the latest collection = the newest run of response-days where consecutive
-- days are no more than 7 days apart. Returns the first day of that run
-- (NULL when the org/company has no responses).

CREATE OR REPLACE FUNCTION public.get_latest_collection_start(
    p_org     UUID,
    p_company UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH days AS (
    SELECT DISTINCT pr.created_at::date AS d
    FROM public.organization_companies oc
    JOIN public.prompt_responses pr ON pr.company_id = oc.company_id
    WHERE oc.organization_id = p_org
      AND (p_company IS NULL OR oc.company_id = p_company)
  ),
  seq AS (
    -- newer = the next-more-recent day with responses
    SELECT d, LAG(d) OVER (ORDER BY d DESC) AS newer
    FROM days
  ),
  grp AS (
    -- walking from newest to oldest, a >7-day gap starts an older collection
    SELECT d,
           SUM(CASE WHEN newer IS NOT NULL AND newer - d > 7 THEN 1 ELSE 0 END)
             OVER (ORDER BY d DESC) AS g
    FROM seq
  )
  SELECT MIN(d)::timestamptz FROM grp WHERE g = 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_collection_start(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_latest_collection_start(UUID, UUID) IS
  'First day of the most recent collection burst (response-days ≤7 days apart) for an org/company. Feeds the "latest collection only" rescore scope.';

NOTIFY pgrst, 'reload schema';
