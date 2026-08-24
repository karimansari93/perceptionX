-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312130058; this file was
-- back-filled afterwards and therefore post-dates the deployment.


INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
('hilton worldwide holdings', 'Hilton'),
('hilton worldwide holdings inc.', 'Hilton'),
('mckinsey & company brasil', 'Mckinsey'),
('mckinsey & company india', 'Mckinsey'),
('mckinsey & company france', 'Mckinsey'),
('mckinsey & company germany', 'Mckinsey'),
('mckinsey & company china', 'Mckinsey'),
('mckinsey & company uk', 'Mckinsey'),
('yum brands', 'Yum Brands'),
('yum! brands germany', 'Yum Brands'),
('yum china holdings', 'Yum Brands'),
('yum china holdings inc.', 'Yum Brands'),
('yum! brands inc.', 'Yum Brands')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

