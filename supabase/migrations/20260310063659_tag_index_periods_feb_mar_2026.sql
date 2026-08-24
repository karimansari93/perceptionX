-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260310063659; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Tag February 2026 responses missing index_period
UPDATE prompt_responses
SET index_period = '2026-02'
WHERE for_index = true
AND index_period IS NULL
AND tested_at >= '2026-02-01'
AND tested_at < '2026-03-01';

-- Tag March 2026 responses missing index_period
UPDATE prompt_responses
SET index_period = '2026-03'
WHERE for_index = true
AND index_period IS NULL
AND tested_at >= '2026-03-01'
AND tested_at < '2026-04-01';

