-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260709145055; this file was
-- back-filled afterwards and therefore post-dates the deployment.

UPDATE organization_companies
SET organization_id = 'ed616d59-cfd5-4f9e-80c2-9428f629245a'  -- Percentiles
WHERE organization_id = '4cba160e-dc70-41b6-9158-b36a336c6874'  -- Pepsico
  AND company_id IN (
    '00abea47-481d-4828-9273-d7e50e6729dd',
    '9ca31830-7697-46a6-8c2c-e073763039fc',
    '86663fb9-f4d7-452e-a687-320ecdf3b6aa'
  );
