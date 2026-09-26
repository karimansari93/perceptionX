-- Competitor benchmarks: clients see their own scores and anonymous peer
-- statistics, never other companies' names or scores.
--
-- competitor_benchmarks_mv (company × market scores for every tracked
-- company) was readable in full by any signed-in user, and the EPS drilldown
-- listed every company in the market by name with its sentiment.

-- Can the caller see benchmarks for a company of this name? Benchmarks are
-- keyed by company name (a brand spans several company rows).
CREATE OR REPLACE FUNCTION public.can_view_company_name(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1
        FROM companies c
        JOIN organization_companies oc ON oc.company_id = c.id
        JOIN organization_members om ON om.organization_id = oc.organization_id
        WHERE om.user_id = auth.uid()
          AND lower(c.name) = lower(p_name)
      );
$$;

REVOKE ALL ON FUNCTION public.can_view_company_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_company_name(text) TO authenticated, service_role;

-- The matview keeps its data under a new name; a filtered view takes the old
-- name so existing reads of the caller's own row keep working. peer_companies
-- (the names of the peer set) is not exposed.
ALTER MATERIALIZED VIEW public.competitor_benchmarks_mv RENAME TO competitor_benchmarks_data;

REVOKE SELECT ON public.competitor_benchmarks_data FROM PUBLIC, anon, authenticated;

CREATE VIEW public.competitor_benchmarks_mv
WITH (security_invoker = false) AS
SELECT company_name, market, responses, mentions, pos_themes, neg_themes,
       total_citations, valid_citations,
       visibility_pct, visibility_rank, vis_cohort_size, visibility_peer_avg,
       visibility_peer_median, visibility_gap,
       sentiment_pct, sentiment_rank, sent_cohort_size, sentiment_peer_avg,
       sentiment_peer_median, sentiment_gap,
       relevance_pct, relevance_rank, rel_cohort_size, relevance_peer_avg,
       relevance_peer_median, relevance_gap,
       last_refreshed
FROM public.competitor_benchmarks_data b
WHERE public.can_view_company_name(b.company_name)
   OR COALESCE(auth.role(), '') = 'service_role';

GRANT SELECT ON public.competitor_benchmarks_mv TO authenticated, service_role;

-- Anonymous peer statistics for one company in one market: ranges, averages
-- and the sorted peer values (no names), for the drilldown's range bars and
-- "higher than N of M peers".
CREATE OR REPLACE FUNCTION public.get_market_peer_stats(p_company_name text, p_market text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_view_company_name(p_company_name) THEN
    RAISE insufficient_privilege USING MESSAGE = 'no access to this company';
  END IF;

  WITH peers AS (
    SELECT visibility_pct, sentiment_pct, relevance_pct,
           CASE WHEN sentiment_pct IS NOT NULL AND visibility_pct IS NOT NULL AND relevance_pct IS NOT NULL
                THEN sentiment_pct * 0.5 + visibility_pct * 0.3 + relevance_pct * 0.2 END AS eps
    FROM public.competitor_benchmarks_data
    WHERE market = p_market
      AND lower(company_name) <> lower(p_company_name)
  )
  SELECT jsonb_build_object(
    'peer_count', count(*),
    'visibility', jsonb_build_object('min', min(visibility_pct), 'max', max(visibility_pct), 'avg', avg(visibility_pct)),
    'sentiment',  jsonb_build_object('min', min(sentiment_pct),  'max', max(sentiment_pct),  'avg', avg(sentiment_pct),
                                     'values', COALESCE(jsonb_agg(sentiment_pct ORDER BY sentiment_pct) FILTER (WHERE sentiment_pct IS NOT NULL), '[]'::jsonb)),
    'relevance',  jsonb_build_object('min', min(relevance_pct),  'max', max(relevance_pct),  'avg', avg(relevance_pct)),
    'eps',        jsonb_build_object('min', min(eps), 'max', max(eps), 'avg', avg(eps))
  ) INTO v_result
  FROM peers;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_market_peer_stats(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_market_peer_stats(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
