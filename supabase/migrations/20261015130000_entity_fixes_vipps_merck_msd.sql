-- Entity fixes found while checking the first automatic canonicalization runs
-- (2026-10-15, Karim: "I need this all done by you").
--
-- 1. Vipps MobilePay is a real company (Vipps and MobilePay merged); the cheap
--    first pass called it two companies joined. The first pass can no longer
--    drop a name on its own (suggest-entity-canonicalization).
-- 2. MSD is Merck & Co.'s name outside the US and Canada: one employer. The
--    alias system had them as two canonicals; MSD's aliases move to Merck & Co.
-- 3. The legacy public-Index list (company_canonical_names) merged Merck & Co.
--    (US) and Merck KGaA (Germany) into one "Merck", and had MSD country names
--    pointing at themselves. Aligned with the alias system: "Merck" is Merck
--    KGaA (with EMD Group), "Merck & Co." is the US company with every MSD name.

-- 1. Vipps MobilePay
UPDATE public.entity_alias_suggestions
SET suggested_is_non_entity = false,
    suggested_canonical_name = 'Vipps MobilePay',
    suggested_entity_type = 'financial',
    llm_rationale = 'Corrected 2026-10-15: real Nordic payments company, not a non-entity.'
WHERE normalized_alias = 'vipps mobilepay' AND status = 'pending';

UPDATE public.canonical_entities
SET entity_type = 'financial', is_active = true,
    notes = 'Corrected 2026-10-15: real company, wrongly auto-classified as non-entity.',
    updated_at = now()
WHERE normalized_name = 'vipps mobilepay';

-- 2. MSD -> Merck & Co.
UPDATE public.entity_aliases ea
SET canonical_id = mc.id
FROM public.canonical_entities msd, public.canonical_entities mc
WHERE msd.normalized_name = 'msd' AND mc.normalized_name = 'merck and co'
  AND ea.canonical_id = msd.id;

UPDATE public.canonical_entities
SET is_active = false,
    notes = 'Merged into Merck & Co. 2026-10-15: MSD is its name outside the US and Canada.',
    updated_at = now()
WHERE normalized_name = 'msd';

-- 3. Legacy public-Index list
UPDATE public.company_canonical_names
SET canonical_name = 'Merck & Co.', brand_key = 'merck & co', updated_at = now()
WHERE variant_name IN (
  'merck & co', 'merck & co.', 'merck & co inc', 'merck & co inc.', 'merck & co/msd',
  'merck (msd)', 'merck/msd', 'merck sharp and dohme', 'merck sharp & dohme',
  'merck sharp & dohme (msd)', 'merck animal health', 'msd', 'msd animal health',
  'msd saúde animal', 'msd sharp & dohme', 'msd sharp & dohme gmbh', 'msd brasil',
  'msd china', 'msd deutschland', 'msd france', 'msd (pharmaceutical)',
  'msd santé animale france', 'msd uk'
);

UPDATE public.company_canonical_names
SET canonical_name = 'Merck', brand_key = 'merck', updated_at = now()
WHERE variant_name IN (
  'merck', 'merck group', 'merck gruppe', 'merck india', 'merck kgaa',
  'merck kgaa (darmstadt)', 'merck life science', 'emd group', 'emd group (merck kgaa)'
);

-- Logos: merck.com is Merck & Co.'s site; Merck KGaA is merckgroup.com.
UPDATE public.company_canonical_names SET website_domain = 'merck.com'
WHERE variant_name = 'merck & co';
UPDATE public.company_canonical_names SET website_domain = 'merckgroup.com'
WHERE variant_name = 'merck';

-- 4. Canal+: the canonical was stored as 'canal+' (older normalization kept
--    the '+'); normalize_entity_name('Canal+') is now 'canal', so new mentions
--    never matched and the automatic apply bounced them. Alias the current
--    forms to the existing canonical.
INSERT INTO public.entity_aliases (canonical_id, alias, normalized_alias, source, approved_at)
SELECT ce.id, s.raw_alias, s.normalized_alias, 'manual', now()
FROM public.entity_alias_suggestions s
JOIN public.canonical_entities ce ON ce.canonical_name = 'Canal+'
WHERE s.normalized_alias IN (public.normalize_entity_name('Canal+'), public.normalize_entity_name('Canal+ Polska'))
ON CONFLICT (normalized_alias) DO NOTHING;
