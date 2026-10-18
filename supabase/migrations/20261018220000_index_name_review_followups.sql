-- Follow-ups after applying the new-country name review (spot checks).

-- Spelling answers that were wrong in casing.
SELECT public.index_fold_entry('PriceLine Pharmacy', 'Priceline Pharmacy', true);
SELECT public.index_fold_entry('TrueCaller', 'Truecaller', true);

-- Singapore's two big banks: short and full names were separate entries.
INSERT INTO public.company_canonical_names (variant_name, canonical_name, is_verified, source, variant_type, brand_key)
VALUES ('ocbc', 'OCBC', true, 'manual', 'alias', 'ocbc'),
       ('oversea-chinese banking corporation', 'OCBC', true, 'manual', 'alias', 'ocbc'),
       ('ocbc digital', 'OCBC', true, 'manual', 'alias', 'ocbc'),
       ('uob', 'UOB', true, 'manual', 'alias', 'uob'),
       ('united overseas bank', 'UOB', true, 'manual', 'alias', 'uob')
ON CONFLICT (variant_name) DO NOTHING;
SELECT public.index_fold_entry('Ocbc Bank', 'OCBC', true);

-- Size labels too small for the company (would hide it from the Index).
UPDATE public.company_employee_tiers
SET estimated_tier = v.tier, confidence = 'medium', classified_by = 'manual', classified_at = now()
FROM (VALUES ('stc', '5000-49999'), ('ahold delhaize', '50000+'), ('woolworths group', '50000+')) AS v(name, tier)
WHERE lower(company_name) = v.name;
