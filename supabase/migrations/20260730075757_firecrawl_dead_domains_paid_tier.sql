-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260730075757; this file was
-- back-filled afterwards and therefore post-dates the deployment.

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

NOTIFY pgrst, 'reload schema';
