-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218124612; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Create missing RLS-safe view for company_sentiment_scores_mv
CREATE VIEW company_sentiment_scores AS
SELECT s.*
FROM company_sentiment_scores_mv s
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = s.company_id AND cm.user_id = (SELECT auth.uid())
);

