-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260408125033; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names SET canonical_name = 'ExxonMobil'   WHERE lower(canonical_name) = 'exxonmobil';
UPDATE company_canonical_names SET canonical_name = 'TotalEnergies' WHERE lower(canonical_name) = 'totalenergies';
UPDATE company_canonical_names SET canonical_name = 'KBR'           WHERE lower(canonical_name) = 'kbr';

UPDATE company_employee_tiers SET company_name = 'ExxonMobil'   WHERE lower(company_name) = 'exxonmobil';
UPDATE company_employee_tiers SET company_name = 'TotalEnergies' WHERE lower(company_name) = 'totalenergies';
UPDATE company_employee_tiers SET company_name = 'KBR'           WHERE lower(company_name) = 'kbr';

