-- =============================================================================
-- Dynamic Firecrawl deny-list: firecrawl_dead_domains
-- =============================================================================
-- Domains that history proves almost never yield a publication date. The
-- extract-recency-scores edge function loads this list and SKIPS THE PAID
-- FIRECRAWL TIER for these domains (the free tiers — url-pattern, evergreen,
-- YouTube/Reddit APIs, meta-tag fetch, gpt-4.1-nano — still run). This stops us
-- paying 1-5 credits per URL to re-scrape domains that fail ~everything, ~every
-- time (Instagram, Glassdoor variants, aggregators, etc.).
--
-- Rolling 90-day window: "dead" is judged only on recent rows, so a domain that
-- starts exposing dates again (site adds meta tags, new URL scheme) climbs back
-- above the threshold on the next refresh and drops off the list automatically.
-- No permanent blacklisting.
--
-- Thresholds:
--   * >= 25 attempts in the last 90 days  (enough signal to trust the rate)
--   * <  5% of those produced a recency_score (date_rate below which paying to
--     scrape is not worth it)
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS firecrawl_dead_domains AS
WITH recent AS (
  SELECT domain, recency_score
  FROM url_recency_cache
  WHERE created_at > now() - interval '90 days'
    AND domain IS NOT NULL
    AND domain <> 'unknown'
)
SELECT
  domain,
  count(*)                                              AS attempts_90d,
  count(*) FILTER (WHERE recency_score IS NOT NULL)     AS dated_90d,
  round(
    count(*) FILTER (WHERE recency_score IS NOT NULL)::numeric
    / nullif(count(*), 0), 4
  )                                                     AS date_rate_90d
FROM recent
GROUP BY domain
HAVING count(*) >= 25
   AND count(*) FILTER (WHERE recency_score IS NOT NULL)::numeric
       / nullif(count(*), 0) < 0.05;

-- Unique index enables REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking).
CREATE UNIQUE INDEX IF NOT EXISTS idx_firecrawl_dead_domains_domain
  ON firecrawl_dead_domains (domain);

GRANT SELECT ON firecrawl_dead_domains TO authenticated, service_role;

-- Refresh helper (CONCURRENTLY so reads never block during the rebuild).
CREATE OR REPLACE FUNCTION public.refresh_firecrawl_dead_domains()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY firecrawl_dead_domains;
END;
$$;

-- Daily rebuild at 04:45 UTC (after the other nightly maintenance jobs).
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-firecrawl-dead-domains');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-firecrawl-dead-domains',
  '45 4 * * *',
  $cron$ SELECT public.refresh_firecrawl_dead_domains(); $cron$
);

NOTIFY pgrst, 'reload schema';
