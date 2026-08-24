-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416070238; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'snowflake'       AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'revolut'         AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'wise'            AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'ovhcloud'        AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'beigene'         AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'c6 bank'         AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'trade republic'  AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'freshworks'      AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'e.l.f. beauty'   AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'rapid7'          AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'stoneco'         AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '5000-49999' WHERE lower(company_name) = 'shake shack'     AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'getyourguide'    AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'gitlab'          AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'airwallex'       AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'huda beauty'     AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'chargebee'       AND estimated_tier = 'unknown';
UPDATE company_employee_tiers SET estimated_tier = '500-4999'   WHERE lower(company_name) = 'agibank'         AND estimated_tier = 'unknown';

