-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260218105106; this file was
-- back-filled afterwards and therefore post-dates the deployment.


DROP VIEW IF EXISTS company_overview_metrics;
DROP VIEW IF EXISTS company_top_sources;
DROP VIEW IF EXISTS company_competitors;
DROP VIEW IF EXISTS company_llm_rankings;

CREATE VIEW company_overview_metrics AS
SELECT m.*
FROM company_overview_metrics_mv m
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = m.company_id AND cm.user_id = (SELECT auth.uid())
);

CREATE VIEW company_top_sources AS
SELECT s.*
FROM company_top_sources_mv s
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = s.company_id AND cm.user_id = (SELECT auth.uid())
);

CREATE VIEW company_competitors AS
SELECT c.*
FROM company_competitors_mv c
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = c.company_id AND cm.user_id = (SELECT auth.uid())
);

CREATE VIEW company_llm_rankings AS
SELECT r.*
FROM company_llm_rankings_mv r
WHERE EXISTS (
  SELECT 1 FROM company_members cm
  WHERE cm.company_id = r.company_id AND cm.user_id = (SELECT auth.uid())
);

