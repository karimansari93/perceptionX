-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260408131012; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Remove the overbroad 'capital' source classification that's catching Capital Group etc.
DELETE FROM company_entity_classifications
WHERE entity_type = 'source' AND company_name = 'capital';

-- Remove the empty string entry which would match everything
DELETE FROM company_entity_classifications
WHERE entity_type = 'source' AND company_name = '';

