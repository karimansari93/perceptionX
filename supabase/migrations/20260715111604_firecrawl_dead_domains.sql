-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260715111604; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Dynamic Firecrawl deny-list: firecrawl_dead_domains
-- Domains that history proves almost never yield a publication date. The
-- extract-recency-scores edge function loads this list and SKIPS THE PAID
-- FIRECRAWL TIER for these domains (free tiers still run). Rolling 90-day
-- window so a domain that starts yielding dates again rolls off automatically.

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_firecrawl_dead_domains_domain
  ON firecrawl_dead_domains (domain);

GRANT SELECT ON firecrawl_dead_domains TO authenticated, service_role;

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
