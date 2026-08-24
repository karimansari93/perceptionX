-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260415130415; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- 'Capital' is a French business magazine, not a company employer
INSERT INTO company_entity_classifications (company_name, entity_type, reason, classified_by)
VALUES ('capital', 'source', 'French business magazine, not an employer', 'manual')
ON CONFLICT (company_name) DO UPDATE SET entity_type = 'source', reason = EXCLUDED.reason;

