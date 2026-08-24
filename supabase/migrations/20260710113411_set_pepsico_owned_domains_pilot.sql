-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260710113411; this file was
-- back-filled afterwards and therefore post-dates the deployment.

INSERT INTO company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
VALUES
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepsico.com', 'corporate', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepsicojobs.com', 'careers', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepsico.com.br', 'regional', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepsifrontlinecareers.com', 'careers', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'life.pepsicojobs.com', 'careers', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'stories.pepsicojobs.com', 'careers', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepjobs.mypepsico.com', 'careers', false, 'Pilot owned-domain set, Option B'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepsico2026.ciadetalentos.com.br', 'careers', false, 'Pilot owned-domain set, Option B - PepsiCo Brazil campaign microsite (vendor-hosted, PepsiCo-controlled)'),
  ('19a134db-bdd1-466f-ba15-0f825a06e748', 'pepsicofirstgen-2026.ciadetalentos.com.br', 'careers', false, 'Pilot owned-domain set, Option B - PepsiCo Brazil campaign microsite (vendor-hosted, PepsiCo-controlled)');
