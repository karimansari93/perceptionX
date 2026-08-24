-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260416070640; this file was
-- back-filled afterwards and therefore post-dates the deployment.


UPDATE company_canonical_names SET canonical_name = '1&1',             updated_at = now() WHERE lower(canonical_name) IN ('1&1 ag', '1&1 / ionos', '1&1 / united internet', '1&1 / united internet group', '1&1 versatel', '1&1 versatel security');
UPDATE company_canonical_names SET canonical_name = '360 Security Technology', updated_at = now() WHERE lower(canonical_name) IN ('360 security', '360 security technology (qihoo 360)');
UPDATE company_canonical_names SET canonical_name = 'AAR',             updated_at = now() WHERE lower(canonical_name) IN ('aar corp', 'aar corp.');
UPDATE company_canonical_names SET canonical_name = 'AAM',             updated_at = now() WHERE lower(canonical_name) = 'aam llc';
UPDATE company_canonical_names SET canonical_name = 'Abbott',          updated_at = now() WHERE lower(canonical_name) IN ('abbott laboratories', 'abbott laboratories ltd');
UPDATE company_canonical_names SET canonical_name = 'Adata',           updated_at = now() WHERE lower(canonical_name) IN ('adata technology', 'adata technology (usa) co.');
UPDATE company_canonical_names SET canonical_name = 'Anywhere Real Estate', updated_at = now() WHERE lower(canonical_name) IN ('anywhere real estate inc', 'anywhere real estate inc.');
UPDATE company_canonical_names SET canonical_name = 'Apollo Tyres',    updated_at = now() WHERE lower(canonical_name) IN ('apollo tyres ltd', 'apollo tyres ltd.');
UPDATE company_canonical_names SET canonical_name = 'Aroundtown',      updated_at = now() WHERE lower(canonical_name) = 'aroundtown sa';
UPDATE company_canonical_names SET canonical_name = 'Amway India',     updated_at = now() WHERE lower(canonical_name) IN ('amway india enterprises pvt. ltd', 'amway india enterprises pvt. ltd.');
UPDATE company_canonical_names SET canonical_name = 'Amrest',          updated_at = now() WHERE lower(canonical_name) = 'amrest holdings';
UPDATE company_canonical_names SET canonical_name = 'Allstate',        updated_at = now() WHERE lower(canonical_name) = 'allstate corporation';
UPDATE company_canonical_names SET canonical_name = 'Aché Laboratórios', updated_at = now() WHERE lower(canonical_name) = 'aché laboratórios farmacêuticos';
UPDATE company_canonical_names SET canonical_name = 'Bellway',         updated_at = now() WHERE lower(canonical_name) = 'bellway plc';
UPDATE company_canonical_names SET canonical_name = 'BH Management Services', updated_at = now() WHERE lower(canonical_name) = 'bh management services llc';
UPDATE company_canonical_names SET canonical_name = 'Bharat Heavy Electricals Limited', updated_at = now() WHERE lower(canonical_name) = 'bharat heavy electricals limited (bhel)';
UPDATE company_canonical_names SET canonical_name = 'Bob''s',          updated_at = now() WHERE lower(canonical_name) = 'bob''s (quick service restaurants)';

