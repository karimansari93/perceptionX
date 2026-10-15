-- Thermo Fisher Scientific: group its variants on the public Index (2026-10-15,
-- approved by Karim).
--
-- The public Index maps raw company names through company_canonical_names.
-- "thermo fisher scientific uk" pointed at itself, and "thermo fisher
-- scientific france" / "thermo fisher clinical" had no row, so all three showed
-- as separate companies. Backup of the one row changed here (before):
--   id 4543d6c1-ae6a-4251-9ad3-7bf9988a60c5, variant_name 'thermo fisher scientific uk',
--   canonical_name 'Thermo Fisher Scientific UK', variant_type 'alias',
--   brand_key 'thermo fisher scientific uk', source 'manual', is_verified true.
--
-- The same variants are added to entity_aliases so client dashboards agree.

UPDATE public.company_canonical_names
SET canonical_name = 'Thermo Fisher Scientific',
    variant_type = 'geo',
    brand_key = 'thermo fisher scientific',
    updated_at = now()
WHERE variant_name = 'thermo fisher scientific uk';

INSERT INTO public.company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
VALUES
  ('thermo fisher scientific france', 'Thermo Fisher Scientific', true, 'manual', 'geo', 'thermo fisher scientific'),
  ('thermo fisher clinical', 'Thermo Fisher Scientific', true, 'manual', 'subsidiary', 'thermo fisher clinical'),
  ('thermo scientific', 'Thermo Fisher Scientific', true, 'manual', 'subsidiary', 'thermo scientific'),
  ('thermo fisher scientific/patheon', 'Thermo Fisher Scientific', true, 'manual', 'subsidiary', 'patheon')
ON CONFLICT (variant_name) DO UPDATE
SET canonical_name = excluded.canonical_name, updated_at = now();

INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
SELECT ce.id, v.alias, public.normalize_entity_name(v.alias), 'manual', now()
FROM (VALUES
  ('Thermo Fisher Scientific UK'),
  ('Thermo Fisher Scientific France'),
  ('Thermo Fisher Clinical'),
  ('Thermo Scientific'),
  ('Thermo Fisher Scientific/Patheon')
) AS v(alias)
JOIN public.canonical_entities ce ON ce.normalized_name = 'thermo fisher scientific'
ON CONFLICT (normalized_alias) DO NOTHING;
