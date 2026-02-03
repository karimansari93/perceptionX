-- ============================================================================
-- Secure views over company metrics materialized views
-- ============================================================================
-- PostgreSQL does not support RLS on materialized views. So we create regular
-- views that filter by company_members so authenticated users see only rows
-- for companies they belong to. The app queries these views instead of the MVs.

-- Sentiment: view that exposes MV rows only for companies the user is a member of
CREATE OR REPLACE VIEW company_sentiment_scores AS
SELECT mv.*
FROM company_sentiment_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);

GRANT SELECT ON company_sentiment_scores TO authenticated;

COMMENT ON VIEW company_sentiment_scores IS
  'RLS-safe view over company_sentiment_scores_mv; use this for dashboard queries.';

-- Relevance: same
CREATE OR REPLACE VIEW company_relevance_scores AS
SELECT mv.*
FROM company_relevance_scores_mv mv
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = mv.company_id
    AND cm.user_id = auth.uid()
);

GRANT SELECT ON company_relevance_scores TO authenticated;

COMMENT ON VIEW company_relevance_scores IS
  'RLS-safe view over company_relevance_scores_mv; use this for dashboard queries.';
