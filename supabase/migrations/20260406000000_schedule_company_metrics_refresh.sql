-- Schedule hourly refresh of company_sentiment_scores_mv and company_relevance_scores_mv
-- Mirrors the existing 'refresh-rankings-every-hour' pattern
-- Both MVs are refreshed by the existing refresh_company_metrics() function
SELECT cron.schedule(
  'refresh-company-metrics-every-hour',
  '0 * * * *',
  'SELECT refresh_company_metrics()'
);
