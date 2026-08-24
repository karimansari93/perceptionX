-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260312130805; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- Fix mappings where canonical_name is itself a variant (self-referential or pointing to wrong target)
UPDATE company_canonical_names SET canonical_name = 'Ford Motor' WHERE lower(variant_name) = 'ford motor company' AND canonical_name = 'Ford Motor Company';
UPDATE company_canonical_names SET canonical_name = 'BMW' WHERE lower(variant_name) = 'bmw of north america' AND canonical_name = 'Bmw of North America';

-- Add missing Deutschland mappings not yet covered
INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
('alter solutions deutschland', 'Alter Solutions'),
('circet deutschland', 'Circet'),
('compass group deutschland', 'Compass Group'),
('grafton deutschland', 'Grafton'),
('domino''s pizza deutschland', 'Domino''s Pizza'),
('burger king deutschland', 'Burger King')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- Add missing Limited mappings
INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
('bharat electronics limited', 'Bharat Electronics'),
('bharat dynamics limited', 'Bharat Dynamics'),
('bharat sanchar nigam limited', 'Bharat Sanchar Nigam'),
('coal india limited', 'Coal India'),
('cmoc group limited', 'Cmoc Group'),
('bajaj capital limited', 'Bajaj Capital'),
('axis securities limited', 'Axis Securities'),
('anand rathi share and stock brokers limited', 'Anand Rathi'),
('ancol pet products limited', 'Ancol Pet Products'),
('biological e. limited', 'Biological E'),
('centrum wealth limited', 'Centrum Wealth'),
('ciena india private limited', 'Ciena India'),
('culina logistics limited', 'Culina Logistics'),
('custom interconnect limited', 'Custom Interconnect'),
('garware technical fibres limited', 'Garware Technical Fibres'),
('genistar limited', 'Genistar'),
('great bear distribution limited', 'Great Bear Distribution'),
('gregory distribution limited', 'Gregory Distribution'),
('arvind limited', 'Arvind'),
('aequs private limited', 'Aequs'),
('celio retail private limited', 'Celio Retail'),
('bharat financial inclusion limited', 'Bharat Financial Inclusion')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- Fix Company mappings pointing to wrong canonical
INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
('ford motor company', 'Ford Motor'),
('ford motor private limited', 'Ford Motor'),
('deere & company', 'John Deere'),
('duluth trading company', 'Duluth Trading'),
('ghirardelli chocolate company', 'Ghirardelli'),
('harris williams & company', 'Harris Williams'),
('behr paint company', 'Behr Paint'),
('crew clothing company', 'Crew Clothing'),
('china life insurance company', 'China Life Insurance'),
('china pacific insurance company', 'China Pacific Insurance'),
('china international capital corporation limited', 'China International Capital Corporation'),
('china aviation industry corporation limited', 'China Aviation Industry Corporation'),
('allianz life insurance company of north america', 'Allianz Life Insurance')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- Other regional variants missing mappings
INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
('aioi nissay dowa europe', 'Aioi Nissay Dowa'),
('daimler trucks north america', 'Daimler Trucks'),
('harting inc of north america', 'Harting'),
('gp north america', 'Georgia-Pacific'),
('coach shanghai limited', 'Coach'),
('deloitte consulting llp', 'Deloitte'),
('blake morgan llp', 'Blake Morgan'),
('american transmission company', 'American Transmission')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- Yum China → Yum (confirmed by user)
INSERT INTO company_canonical_names (variant_name, canonical_name) VALUES
('yum china', 'Yum'),
('yum china holdings', 'Yum'),
('yum! brands', 'Yum'),
('yum brands', 'Yum')
ON CONFLICT (variant_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- Now refresh the materialized view to apply all mappings
REFRESH MATERIALIZED VIEW rankings_overview;

-- Also refresh rankings_historical if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'rankings_historical') THEN
    REFRESH MATERIALIZED VIEW rankings_historical;
  END IF;
END $$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

