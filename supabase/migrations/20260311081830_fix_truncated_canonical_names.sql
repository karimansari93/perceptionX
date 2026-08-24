-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260311081830; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names SET canonical_name = 'Air France' WHERE variant_name = 'air france';
UPDATE company_canonical_names SET canonical_name = 'Air India' WHERE variant_name = 'air india';
UPDATE company_canonical_names SET canonical_name = 'Air Canada' WHERE variant_name = 'air canada';
UPDATE company_canonical_names SET canonical_name = 'Air China' WHERE variant_name = 'air china';
UPDATE company_canonical_names SET canonical_name = 'Bank of China' WHERE variant_name = 'bank of china';
UPDATE company_canonical_names SET canonical_name = 'Bank of China' WHERE variant_name = 'bank of china (boc)';
UPDATE company_canonical_names SET canonical_name = 'Banco do Brasil' WHERE variant_name = 'bank of brazil';
UPDATE company_canonical_names SET canonical_name = 'Digital China' WHERE variant_name = 'digital china';
UPDATE company_canonical_names SET canonical_name = 'MGM China' WHERE variant_name = 'mgm china';
UPDATE company_canonical_names SET canonical_name = 'Natura & Co' WHERE variant_name = 'natura & co';
UPDATE company_canonical_names SET canonical_name = 'Quest Global' WHERE variant_name = 'quest global';
UPDATE company_canonical_names SET canonical_name = 'Sands China' WHERE variant_name = 'sands china';
UPDATE company_canonical_names SET canonical_name = 'Thomas Cook' WHERE variant_name = 'thomas cook india';
UPDATE company_canonical_names SET canonical_name = 'UnitedHealth Group' WHERE variant_name = 'unitedhealth group';
UPDATE company_canonical_names SET canonical_name = 'Yum! Brands' WHERE variant_name = 'yum';
UPDATE company_canonical_names SET canonical_name = 'Yum China' WHERE variant_name = 'yum china';

