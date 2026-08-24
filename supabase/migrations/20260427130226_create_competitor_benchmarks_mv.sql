-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260427130226; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Materialized view powering the per-market peer benchmark dashboard.
-- Generic over org name: any company can be benchmarked against any panel org.
-- Display fields (peer_index, position_label, gap_points) are designed to never
-- expose cohort size or rank. Internal fields (cohort_size, rank_in_cohort) are
-- retained for confidence filtering but should not be surfaced to clients.

DROP MATERIALIZED VIEW IF EXISTS competitor_benchmarks_mv CASCADE;

CREATE MATERIALIZED VIEW competitor_benchmarks_mv AS
WITH normalized AS (
  -- Aggregate per (company × market × metric_source)
  SELECT
    c.id AS company_id,
    c.name AS company_name,
    REPLACE(REPLACE(REPLACE(
      cp.location_context,
      'the United States', 'United States'),
      'the United Kingdom', 'United Kingdom'),
      'the Netherlands', 'Netherlands') AS market,
    COUNT(DISTINCT pr.id) AS responses,
    COUNT(DISTINCT pr.id) FILTER (WHERE pr.company_mentioned) AS mentions,
    COUNT(DISTINCT t.id) FILTER (WHERE t.sentiment = 'positive') AS positive_themes,
    COUNT(DISTINCT t.id) FILTER (WHERE t.sentiment = 'negative') AS negative_themes
  FROM companies c
  JOIN confirmed_prompts cp ON cp.company_id = c.id
  LEFT JOIN prompt_responses pr ON pr.confirmed_prompt_id = cp.id
  LEFT JOIN ai_themes t ON t.response_id = pr.id
  WHERE cp.location_context IS NOT NULL
  GROUP BY c.id, c.name, market
),
metrics AS (
  -- Two metrics per company × market: visibility, sentiment
  SELECT company_id, company_name, market, 'visibility' AS metric,
         responses AS sample_size,
         ROUND(100.0 * mentions / NULLIF(responses, 0), 2) AS value
  FROM normalized WHERE responses >= 20
  UNION ALL
  SELECT company_id, company_name, market, 'sentiment' AS metric,
         positive_themes + negative_themes AS sample_size,
         ROUND(100.0 * positive_themes / NULLIF(positive_themes + negative_themes, 0), 2) AS value
  FROM normalized WHERE positive_themes + negative_themes >= 20
),
panel_companies AS (
  -- Companies that belong to a panel org (Percentiles, future Cloudera-Panel, etc.)
  SELECT DISTINCT oc.company_id, o.name AS panel_org
  FROM organization_companies oc
  JOIN organizations o ON o.id = oc.organization_id
  WHERE o.name ILIKE '%percentile%'
     OR o.name ILIKE '%panel%'
),
-- For each market × metric, compute the peer cohort stats (panel companies only)
peer_stats AS (
  SELECT
    m.market,
    m.metric,
    AVG(m.value) AS peer_avg,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.value) AS peer_median,
    COUNT(*) AS cohort_size
  FROM metrics m
  JOIN panel_companies p ON p.company_id = m.company_id
  GROUP BY m.market, m.metric
),
-- Rank each company within its market × metric cohort (panel companies only, for honest internal rank)
ranked AS (
  SELECT
    m.company_id,
    m.market,
    m.metric,
    RANK() OVER (PARTITION BY m.market, m.metric ORDER BY m.value DESC) AS rank_in_cohort,
    COUNT(*) OVER (PARTITION BY m.market, m.metric) AS expanded_cohort_size
  FROM metrics m
  JOIN panel_companies p ON p.company_id = m.company_id
)
SELECT
  m.company_id,
  m.company_name,
  m.market,
  m.metric,
  m.value AS company_value,
  m.sample_size,
  ROUND(ps.peer_avg::numeric, 2) AS peer_avg,
  ROUND(ps.peer_median::numeric, 2) AS peer_median,
  ps.cohort_size,
  -- Gap (in points) — safe to display
  ROUND((m.value - ps.peer_avg)::numeric, 1) AS gap_points,
  -- Peer index (100 = peer avg) — safe to display, panel-size agnostic
  ROUND((100 * m.value / NULLIF(ps.peer_avg, 0))::numeric, 0)::int AS peer_index,
  -- Position label — human-readable, panel-size agnostic
  CASE
    WHEN m.value - ps.peer_avg >= 5 THEN 'Leading peer set'
    WHEN m.value - ps.peer_avg >= 1 THEN 'Above peer benchmark'
    WHEN m.value - ps.peer_avg > -1 THEN 'In line with peers'
    WHEN m.value - ps.peer_avg > -5 THEN 'Below peer benchmark'
    ELSE 'Trailing peer benchmark'
  END AS position_label,
  -- Internal fields (don't surface in client dashboard)
  r.rank_in_cohort,
  CASE WHEN p.company_id IS NOT NULL THEN true ELSE false END AS is_panel_company
FROM metrics m
JOIN peer_stats ps ON ps.market = m.market AND ps.metric = m.metric
LEFT JOIN ranked r ON r.company_id = m.company_id AND r.market = m.market AND r.metric = m.metric
LEFT JOIN panel_companies p ON p.company_id = m.company_id
WHERE ps.cohort_size >= 2;

CREATE UNIQUE INDEX competitor_benchmarks_mv_uniq
  ON competitor_benchmarks_mv (company_id, market, metric);
CREATE INDEX competitor_benchmarks_mv_company
  ON competitor_benchmarks_mv (company_name);
CREATE INDEX competitor_benchmarks_mv_market_metric
  ON competitor_benchmarks_mv (market, metric);
