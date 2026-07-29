-- ============================================================================
-- Firecrawl dead-domain deny-list: codify in git + score on paid-tier success
-- ============================================================================
-- The firecrawl_dead_domains MV, its refresh function and its cron job were
-- applied directly to production and never landed in a migration, so a deploy
-- from the repo would have dropped them. This migration brings them under
-- version control and fixes how the list is computed.
--
-- Old definition: a domain was denied when fewer than 5% of ALL its cache rows
-- carried a date. That mixes in rows the free tiers resolved -- evergreen
-- careers pages, dates parsed straight out of the URL -- so a domain whose
-- every scrape fails still looks healthy if enough of its URLs never needed
-- scraping. www.google.com was the worst case: 3,143 paid attempts at a 1.7%
-- success rate, held off the list by free-tier rows that put its apparent rate
-- at 22%.
--
-- New definition: only count URLs that actually reached the paid tier, and
-- deny below a 10% success rate there. On production data this takes the list
-- from 10 domains to ~46 and covers reddit.com (798 attempts, 0 successes),
-- quora.com, ziprecruiter.com and the rest of the long tail.
--
-- Rows written as 'problematic-domain' are excluded from the stats: those are
-- URLs we declined to scrape because the domain was already denied. Counting
-- them would let a domain's own skips pin it to the list permanently. Leaving
-- them out means a denied domain's real attempts age out of the 90-day window,
-- it drops off the list, and the next URL from it gets a fresh chance.

DROP MATERIALIZED VIEW IF EXISTS firecrawl_dead_domains;

CREATE MATERIALIZED VIEW firecrawl_dead_domains AS
WITH paid AS (
  SELECT
    domain,
    count(*) AS attempts_90d,
    count(*) FILTER (WHERE recency_score IS NOT NULL) AS dated_90d
  FROM url_recency_cache
  WHERE created_at > (now() - '90 days'::interval)
    AND domain IS NOT NULL
    AND domain <> 'unknown'
    -- Methods reachable only after the free tiers gave up. 'not-found' belongs
    -- here: it means every tier ran and failed, which is a paid failure.
    AND extraction_method IN (
      'firecrawl-metadata', 'firecrawl-json', 'firecrawl-html',
      'firecrawl-relative', 'firecrawl-absolute', 'firecrawl-reddit',
      'openai-html', 'not-found', 'rate-limit-hit'
    )
  GROUP BY domain
)
SELECT
  domain,
  attempts_90d,
  dated_90d,
  round(dated_90d::numeric / NULLIF(attempts_90d, 0)::numeric, 4) AS date_rate_90d
FROM paid
WHERE attempts_90d >= 25
  AND (dated_90d::numeric / NULLIF(attempts_90d, 0)::numeric) < 0.10;

-- REFRESH ... CONCURRENTLY requires a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_firecrawl_dead_domains_domain
  ON firecrawl_dead_domains(domain);

GRANT SELECT ON firecrawl_dead_domains TO authenticated, service_role;

COMMENT ON MATERIALIZED VIEW firecrawl_dead_domains IS
  'Domains whose paid-tier scrapes almost never yield a publication date. The extractor skips the Firecrawl tier for these; free tiers still run, so a domain that starts exposing dates is picked up without paying for it.';

CREATE OR REPLACE FUNCTION public.refresh_firecrawl_dead_domains()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY firecrawl_dead_domains;
END;
$function$;

-- Daily refresh. Unschedule first so re-running this migration is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-firecrawl-dead-domains') THEN
    PERFORM cron.unschedule('refresh-firecrawl-dead-domains');
  END IF;
  PERFORM cron.schedule(
    'refresh-firecrawl-dead-domains',
    '45 4 * * *',
    $cron$ SELECT public.refresh_firecrawl_dead_domains(); $cron$
  );
END;
$$;

REFRESH MATERIALIZED VIEW firecrawl_dead_domains;

NOTIFY pgrst, 'reload schema';
