-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260427130546; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Per-market competitive benchmarks: visibility, sentiment, relevance
-- One row per (company × market). Ranks and peer averages computed within market,
-- excluding self from the peer cohort.
--
-- Cohort = Percentiles org (panel) + active clients. To add a new client, extend
-- the `panel` CTE. To add a new panel, add another org and union it in.

DROP MATERIALIZED VIEW IF EXISTS competitor_benchmarks_mv CASCADE;

CREATE MATERIALIZED VIEW competitor_benchmarks_mv AS
WITH panel AS (
  -- Panel companies (Percentiles org)
  SELECT c.id AS company_id, c.name AS company_name
  FROM organizations o
  JOIN organization_companies oc ON oc.organization_id = o.id
  JOIN companies c ON c.id = oc.company_id
  WHERE o.name = 'Percentiles'
  UNION ALL
  -- Active clients benchmarked against the panel
  SELECT id, name FROM companies WHERE name IN ('Netflix')
),
responses AS (
  SELECT
    p.company_name,
    -- Normalize "the United States" → "United States" etc.
    REPLACE(REPLACE(REPLACE(cp.location_context,
      'the United States', 'United States'),
      'the United Kingdom', 'United Kingdom'),
      'the Netherlands', 'Netherlands') AS market,
    pr.id AS response_id,
    pr.company_mentioned,
    pr.citations
  FROM panel p
  JOIN confirmed_prompts cp ON cp.company_id = p.company_id
  JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
  WHERE cp.location_context IS NOT NULL
),
response_citations AS (
  SELECT
    r.company_name,
    r.market,
    r.response_id,
    r.company_mentioned,
    CASE WHEN jsonb_typeof(r.citations) = 'array'
         THEN jsonb_array_length(r.citations) ELSE 0 END AS total_cits,
    (
      SELECT COUNT(*)
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.citations) = 'array' THEN r.citations ELSE '[]'::jsonb END
      ) AS c
      JOIN url_recency_cache urc ON urc.url = c->>'url'
    ) AS valid_cits
  FROM responses r
),
response_themes AS (
  SELECT
    r.company_name,
    r.market,
    r.response_id,
    COUNT(*) FILTER (WHERE t.sentiment = 'positive') AS pos,
    COUNT(*) FILTER (WHERE t.sentiment = 'negative') AS neg
  FROM responses r
  LEFT JOIN ai_themes t ON t.response_id = r.response_id
  GROUP BY r.company_name, r.market, r.response_id
),
metrics AS (
  SELECT
    rc.company_name,
    rc.market,
    COUNT(*) AS responses,
    COUNT(*) FILTER (WHERE rc.company_mentioned) AS mentions,
    COALESCE(SUM(rc.total_cits) FILTER (WHERE rc.company_mentioned), 0) AS total_citations,
    COALESCE(SUM(rc.valid_cits) FILTER (WHERE rc.company_mentioned), 0) AS valid_citations,
    COALESCE(SUM(rt.pos), 0) AS pos_themes,
    COALESCE(SUM(rt.neg), 0) AS neg_themes
  FROM response_citations rc
  LEFT JOIN response_themes rt
    ON rt.response_id = rc.response_id
  GROUP BY rc.company_name, rc.market
),
metrics_pct AS (
  SELECT
    company_name,
    market,
    responses,
    mentions,
    pos_themes,
    neg_themes,
    total_citations,
    valid_citations,
    ROUND(100.0 * mentions / NULLIF(responses, 0), 1) AS visibility_pct,
    ROUND(100.0 * pos_themes / NULLIF(pos_themes + neg_themes, 0), 1) AS sentiment_pct,
    ROUND(100.0 * valid_citations / NULLIF(total_citations, 0), 1) AS relevance_pct
  FROM metrics
  WHERE responses >= 20  -- minimum sample size to qualify for benchmarking
),
ranked AS (
  SELECT
    m.*,
    RANK() OVER (PARTITION BY market ORDER BY visibility_pct DESC NULLS LAST) AS visibility_rank,
    COUNT(*) FILTER (WHERE visibility_pct IS NOT NULL)
      OVER (PARTITION BY market) AS vis_cohort_size,
    RANK() OVER (PARTITION BY market ORDER BY sentiment_pct DESC NULLS LAST) AS sentiment_rank,
    COUNT(*) FILTER (WHERE sentiment_pct IS NOT NULL)
      OVER (PARTITION BY market) AS sent_cohort_size,
    RANK() OVER (PARTITION BY market ORDER BY relevance_pct DESC NULLS LAST) AS relevance_rank,
    COUNT(*) FILTER (WHERE relevance_pct IS NOT NULL)
      OVER (PARTITION BY market) AS rel_cohort_size
  FROM metrics_pct m
),
peer_stats AS (
  SELECT
    r1.company_name,
    r1.market,
    ROUND(AVG(r2.visibility_pct)::numeric, 1) AS visibility_peer_avg,
    ROUND(AVG(r2.sentiment_pct)::numeric, 1)  AS sentiment_peer_avg,
    ROUND(AVG(r2.relevance_pct)::numeric, 1)  AS relevance_peer_avg,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r2.visibility_pct))::numeric, 1) AS visibility_peer_median,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r2.sentiment_pct))::numeric, 1)  AS sentiment_peer_median,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r2.relevance_pct))::numeric, 1)  AS relevance_peer_median,
    STRING_AGG(DISTINCT r2.company_name, ', ' ORDER BY r2.company_name) AS peer_companies
  FROM ranked r1
  LEFT JOIN ranked r2
    ON r2.market = r1.market
   AND r2.company_name != r1.company_name
  GROUP BY r1.company_name, r1.market
)
SELECT
  r.company_name,
  r.market,
  r.responses,
  r.mentions,
  r.pos_themes,
  r.neg_themes,
  r.total_citations,
  r.valid_citations,
  -- Visibility
  r.visibility_pct,
  r.visibility_rank,
  r.vis_cohort_size,
  ps.visibility_peer_avg,
  ps.visibility_peer_median,
  ROUND((r.visibility_pct - ps.visibility_peer_avg)::numeric, 1) AS visibility_gap,
  -- Sentiment
  r.sentiment_pct,
  r.sentiment_rank,
  r.sent_cohort_size,
  ps.sentiment_peer_avg,
  ps.sentiment_peer_median,
  ROUND((r.sentiment_pct - ps.sentiment_peer_avg)::numeric, 1) AS sentiment_gap,
  -- Relevance
  r.relevance_pct,
  r.relevance_rank,
  r.rel_cohort_size,
  ps.relevance_peer_avg,
  ps.relevance_peer_median,
  ROUND((r.relevance_pct - ps.relevance_peer_avg)::numeric, 1) AS relevance_gap,
  -- Cohort context
  ps.peer_companies,
  NOW() AS last_refreshed
FROM ranked r
LEFT JOIN peer_stats ps
  ON ps.company_name = r.company_name
 AND ps.market = r.market;

CREATE UNIQUE INDEX competitor_benchmarks_mv_pk
  ON competitor_benchmarks_mv (company_name, market);

CREATE INDEX competitor_benchmarks_mv_market
  ON competitor_benchmarks_mv (market);
