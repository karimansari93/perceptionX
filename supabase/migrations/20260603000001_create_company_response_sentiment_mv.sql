-- ============================================================================
-- Materialized View: Company Response Sentiment (per-response sentiment ratio)
-- ============================================================================
-- The dashboard derives a per-response sentiment ratio (positive themes /
-- total themes for that response) and uses it for the sentiment-over-time
-- chart, the Overview trend arrows, and per-prompt sentiment. It used to build
-- this in JS from the full ai_themes pull. This MV precomputes one row per
-- response so the client can fetch ratios directly instead of every theme row.
--
-- No attribute filter here on purpose: the per-response ratio is computed over
-- ALL of a response's themes, matching the existing frontend calculation.
-- Join-free (ai_themes already carries company_id) so refresh is cheap.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_response_sentiment_mv AS
SELECT
  t.company_id,
  t.response_id,
  COUNT(*)                                          AS total_themes,
  COUNT(*) FILTER (WHERE t.sentiment = 'positive')  AS positive_themes,
  (COUNT(*) FILTER (WHERE t.sentiment = 'positive'))::double precision
    / NULLIF(COUNT(*), 0)                           AS sentiment_ratio
FROM public.ai_themes t
WHERE t.response_id IS NOT NULL
GROUP BY t.company_id, t.response_id;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS company_response_sentiment_mv_uniq
  ON public.company_response_sentiment_mv (company_id, response_id);

-- Lookup index for the dashboard's per-company reads.
CREATE INDEX IF NOT EXISTS company_response_sentiment_mv_company_idx
  ON public.company_response_sentiment_mv (company_id);

GRANT SELECT ON public.company_response_sentiment_mv TO anon, authenticated, service_role;
