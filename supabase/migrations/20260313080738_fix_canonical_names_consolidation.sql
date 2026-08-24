-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260313080738; this file was
-- back-filled afterwards and therefore post-dates the deployment.


-- ============================================================
-- Fix 1: Spectrum / Charter → Charter Communications
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Charter Communications'
WHERE variant_name IN ('spectrum', 'charter', 'spectrum (charter)', 'spectrum brazil')
  AND canonical_name NOT IN ('Spectrum Brands', 'Spectrum Talent Management', 'Second Spectrum');

-- Add spectrum → Charter Communications explicitly
UPDATE company_canonical_names
SET canonical_name = 'Charter Communications'
WHERE variant_name = 'spectrum' AND canonical_name = 'Spectrum';

UPDATE company_canonical_names
SET canonical_name = 'Charter Communications'
WHERE variant_name = 'charter' AND canonical_name = 'Charter';

-- ============================================================
-- Fix 2: American → American Airlines
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'American Airlines'
WHERE variant_name = 'american' AND canonical_name = 'American';

-- ============================================================
-- Fix 3: American Fidelity Assurance → American Fidelity
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'American Fidelity'
WHERE variant_name IN ('american fidelity assurance', 'american fidelity assurance company');

-- ============================================================
-- Fix 4: Pepsi → PepsiCo (fix casing too: Pepsico → PepsiCo)
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'PepsiCo'
WHERE variant_name IN (
  'pepsi', 'pepsico', 'pepsico brasil', 'pepsico china',
  'pepsico inc', 'pepsico india', 'pepsico uk'
);

-- ============================================================
-- Fix 5: Republic → Republic Airways
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Republic Airways'
WHERE variant_name = 'republic' AND canonical_name = 'Republic';

-- ============================================================
-- Fix 6: Kraft → Kraft Heinz
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Kraft Heinz'
WHERE variant_name = 'kraft' AND canonical_name = 'Kraft';

-- ============================================================
-- Fix 7: Hermes → Hermès (unify all to Hermès)
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Hermès'
WHERE variant_name IN ('hermes', 'hermes germany') AND canonical_name IN ('Hermes', 'Hermes Germany');

-- ============================================================
-- Fix 8: Aditya Birla Fashion & Retail → Aditya Birla Fashion and Retail
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Aditya Birla Fashion and Retail'
WHERE canonical_name IN ('Aditya Birla Fashion & Retail', 'Aditya Birla Fashion');

-- Also fix the variant that had just "Aditya Birla Fashion"
UPDATE company_canonical_names
SET canonical_name = 'Aditya Birla Fashion and Retail'
WHERE variant_name = 'aditya birla fashion';

-- ============================================================
-- Fix 9: Tui Airways → Tui (consolidate all Tui variants to Tui)
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Tui'
WHERE variant_name IN ('tui airways', 'tui airways uk') 
  AND canonical_name IN ('Tui Airways');

-- ============================================================
-- Fix 10: Jet2.com / Jet2holidays → Jet2
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Jet2'
WHERE variant_name IN ('jet2.com', 'jet2holidays', 'jet2.com & jet2holidays')
  AND canonical_name IN ('Jet2.com', 'Jet2holidays', 'Jet2.Com & Jet2Holidays');

-- ============================================================
-- Fix 11: E.l.f. Cosmetics → E.l.f. Beauty
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'E.l.f. Beauty'
WHERE variant_name = 'e.l.f. cosmetics' AND canonical_name = 'E.l.f. Cosmetics';

-- ============================================================
-- Fix 12: China Southern → China Southern Airlines
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'China Southern Airlines'
WHERE variant_name = 'china southern' AND canonical_name = 'China Southern';

-- ============================================================
-- Fix 13: China Eastern → China Eastern Airlines
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'China Eastern Airlines'
WHERE variant_name = 'china eastern' AND canonical_name = 'China Eastern';

-- ============================================================
-- Fix 14: Deutsche Post DHL → DHL
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'DHL'
WHERE variant_name IN ('deutsche post dhl', 'deutsche post dhl group')
  AND canonical_name IN ('Deutsche Post Dhl');

-- ============================================================
-- Fix 15: Rhenus Logistics → Rhenus (consolidate)
-- ============================================================
UPDATE company_canonical_names
SET canonical_name = 'Rhenus'
WHERE variant_name IN ('rhenus logistics', 'rhenus logistics llc', 'rhenus greater china')
  AND canonical_name IN ('Rhenus Logistics', 'Rhenus Greater');

-- ============================================================
-- Fix 16: GE standalone → add context-specific entries
-- (GE alone is ambiguous; add explicit aerospace/healthcare variants)
-- ============================================================
-- Update "ge" standalone to GE Aerospace as the default (aerospace is the primary public brand)
UPDATE company_canonical_names
SET canonical_name = 'GE Aerospace'
WHERE variant_name = 'ge' AND canonical_name = 'GE';

-- Ensure GE Aerospace canonical is properly cased
UPDATE company_canonical_names
SET canonical_name = 'GE Aerospace'
WHERE variant_name = 'ge aerospace' AND canonical_name = 'Ge Aerospace';

-- Ensure GE Healthcare canonical is properly cased
UPDATE company_canonical_names
SET canonical_name = 'GE Healthcare'
WHERE variant_name IN ('ge healthcare', 'ge healthcare france', 'ge healthcare india', 'ge healthcare technologies')
  AND canonical_name ILIKE 'ge healthcare%';

-- Add "general electric" variant pointing to GE Aerospace
INSERT INTO company_canonical_names (id, variant_name, canonical_name, is_verified, source)
VALUES (gen_random_uuid(), 'general electric', 'GE Aerospace', true, 'manual')
ON CONFLICT DO NOTHING;

