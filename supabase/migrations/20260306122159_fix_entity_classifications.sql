-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260306122159; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Update ambiguous entities to source
UPDATE company_entity_classifications
SET entity_type = 'source', reason = 'Media/directory site, not an employer'
WHERE company_name IN ('built in', 'built in london', 'newsweek');

-- Add Real Leaders
INSERT INTO company_entity_classifications (company_name, entity_type, reason, classified_by, reviewed)
VALUES ('real leaders', 'source', 'Media/awards site, not an employer', 'manual', true)
ON CONFLICT DO NOTHING;

