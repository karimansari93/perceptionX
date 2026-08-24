-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416070706; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names SET canonical_name = 'Acko Insurance',        updated_at = now() WHERE lower(canonical_name) = 'acko general insurance';
UPDATE company_canonical_names SET canonical_name = 'Action Logement',       updated_at = now() WHERE lower(canonical_name) = 'action logement group';
UPDATE company_canonical_names SET canonical_name = 'Adani Defence & Aerospace', updated_at = now() WHERE lower(canonical_name) = 'adani defence and aerospace';
UPDATE company_canonical_names SET canonical_name = 'Admiral',               updated_at = now() WHERE lower(canonical_name) IN ('admiral group', 'admiral insurance group');
UPDATE company_canonical_names SET canonical_name = 'Affinity Petcare',      updated_at = now() WHERE lower(canonical_name) IN ('affinity petcare france sa', 'affinity petcare france sas');
UPDATE company_canonical_names SET canonical_name = 'Atlantica Hotels',      updated_at = now() WHERE lower(canonical_name) IN ('atlantica hotels & resorts', 'atlantica hospitality');
UPDATE company_canonical_names SET canonical_name = 'Beijing Enlight Media', updated_at = now() WHERE lower(canonical_name) = 'beijing enlight media co. ltd';
UPDATE company_canonical_names SET canonical_name = 'Bilibili',              updated_at = now() WHERE lower(canonical_name) = 'bilibili inc.';
UPDATE company_canonical_names SET canonical_name = 'Branicks',              updated_at = now() WHERE lower(canonical_name) = 'branicks group ag';
UPDATE company_canonical_names SET canonical_name = 'Dr. Reddy''s Laboratories', updated_at = now() WHERE lower(canonical_name) = 'dr. reddy''s';
UPDATE company_canonical_names SET canonical_name = 'IHG Hotels & Resorts',  updated_at = now() WHERE lower(canonical_name) IN ('ihg hotels', 'ihg hotels and resorts', 'ihg', 'ihg intercontinental');
UPDATE company_canonical_names SET canonical_name = 'TUI',                   updated_at = now() WHERE lower(canonical_name) IN ('tui careers', 'tui fly', 'tui tui');
UPDATE company_canonical_names SET canonical_name = 'Monzo',                 updated_at = now() WHERE lower(canonical_name) = 'monzo bank';
UPDATE company_canonical_names SET canonical_name = 'Verizon',               updated_at = now() WHERE lower(canonical_name) = 'verizon communications';
UPDATE company_canonical_names SET canonical_name = 'Nubank',                updated_at = now() WHERE lower(canonical_name) = 'nubank pj';
UPDATE company_canonical_names SET canonical_name = 'ByteDance',             updated_at = now() WHERE lower(canonical_name) = 'bytedance retail';
UPDATE company_canonical_names SET canonical_name = 'Biocon',                updated_at = now() WHERE lower(canonical_name) = 'biocon biologics';
UPDATE company_canonical_names SET canonical_name = 'Ipsen',                 updated_at = now() WHERE lower(canonical_name) = 'ipsen pharma biotech';
UPDATE company_canonical_names SET canonical_name = 'Embraer',               updated_at = now() WHERE lower(canonical_name) = 'embraer x';
UPDATE company_canonical_names SET canonical_name = 'easyJet',               updated_at = now() WHERE lower(canonical_name) = 'easyjet holidays';
UPDATE company_canonical_names SET canonical_name = 'Riot Games',            updated_at = now() WHERE lower(canonical_name) = 'riot' AND EXISTS (SELECT 1 FROM company_canonical_names WHERE lower(canonical_name) = 'riot games');
UPDATE company_canonical_names SET canonical_name = 'Alaska Airlines',       updated_at = now() WHERE lower(canonical_name) = 'alaska' AND EXISTS (SELECT 1 FROM company_canonical_names WHERE lower(canonical_name) = 'alaska airlines');
UPDATE company_canonical_names SET canonical_name = 'Comcast',               updated_at = now() WHERE lower(canonical_name) = 'comcast advertising';
UPDATE company_canonical_names SET canonical_name = 'Zalando',               updated_at = now() WHERE lower(canonical_name) = 'zalando health';
UPDATE company_canonical_names SET canonical_name = 'Decathlon',             updated_at = now() WHERE lower(canonical_name) = 'decathlon logistics';
UPDATE company_canonical_names SET canonical_name = 'Lush',                  updated_at = now() WHERE lower(canonical_name) = 'lush cosmetics';
UPDATE company_canonical_names SET canonical_name = 'Google',                updated_at = now() WHERE lower(canonical_name) = 'google fiber';
UPDATE company_canonical_names SET canonical_name = 'Amazon',                updated_at = now() WHERE lower(canonical_name) = 'amazon forever';

