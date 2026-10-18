-- Corrections to groupings made by this morning's alias pass
-- (index_obvious_variant_plan): it puts every "<word> ..." variant under the
-- entry that "<word>" maps to, so separate companies sharing a first word were
-- folded together. Found while checking the job-function rankings ("Virgin
-- Media" in Australian aerospace lists was Virgin Australia).

UPDATE public.company_canonical_names c
SET canonical_name = v.t, brand_key = lower(v.t), source = 'manual', updated_at = now()
FROM (VALUES
  ('virgin australia', 'Virgin Australia'),
  ('virgin australia group', 'Virgin Australia'),
  ('virgin australia regional airlines', 'Virgin Australia'),
  ('virgin mobile', 'Virgin Mobile'),
  ('virgin mobile ksa', 'Virgin Mobile'),
  ('virgin mobile saudi', 'Virgin Mobile'),
  ('virgin mobile mexico', 'Virgin Mobile'),
  ('virgin mobile middle east & africa', 'Virgin Mobile'),
  ('cvs group (petcare)', 'CVS Group'),
  ('cvs group plc', 'CVS Group'),
  ('lincoln electric', 'Lincoln Electric'),
  ('lincoln electric canada', 'Lincoln Electric'),
  ('lincoln electric company', 'Lincoln Electric'),
  ('lincoln motor company', 'Lincoln Motor Company'),
  ('lincoln automotive financial services', 'Lincoln Motor Company'),
  ('lincoln canada', 'Lincoln Canada'),
  ('rotana media group', 'Rotana Media Group'),
  ('sia group', 'Singapore Airlines'),
  ('woolworths holdings', 'Woolworths Holdings'),
  ('woolworths holdings limited', 'Woolworths Holdings'),
  ('fidelity international', 'Fidelity International'),
  ('fidelity australia', 'Fidelity International'),
  ('fidelity international australia', 'Fidelity International'),
  ('fidelity international japan', 'Fidelity International'),
  ('fidelity international singapore', 'Fidelity International'),
  ('fidelity japan', 'Fidelity International'),
  ('fidelity korea', 'Fidelity International'),
  ('fidelity canada', 'Fidelity Investments Canada')
) AS v(variant, t)
WHERE c.variant_name = v.variant;

-- So the nightly alias pass leaves them apart.
INSERT INTO public.company_keep_apart (name, note) VALUES
  ('Virgin Australia', 'Airline; not Virgin Media'),
  ('Virgin Mobile', 'Mobile operators (KSA, Mexico); not Virgin Media'),
  ('CVS Group', 'UK veterinary group; not CVS Health'),
  ('Lincoln Electric', 'Welding manufacturer; not Lincoln Financial'),
  ('Lincoln Motor Company', 'Ford luxury brand; not Lincoln Financial'),
  ('Lincoln Canada', 'Ambiguous; not Lincoln Financial'),
  ('Rotana Media Group', 'Media group; not Rotana Hotels'),
  ('Woolworths Holdings', 'South African retailer; not Woolworths Group (Australia)'),
  ('Fidelity International', 'FIL, separate from Fidelity Investments (US)'),
  ('Fidelity Investments Canada', 'Separate from Fidelity Investments (US)')
ON CONFLICT (name) DO NOTHING;

-- Size labels for the restored entries that had none.
INSERT INTO public.company_employee_tiers (company_name, estimated_tier, confidence, classified_by, classified_at)
SELECT v.n, v.t, 'medium', 'manual', now()
FROM (VALUES ('Virgin Australia', '5000-49999'), ('Woolworths Holdings', '5000-49999'),
             ('Lincoln Motor Company', 'unknown'), ('Lincoln Canada', 'unknown'),
             ('Fidelity Investments Canada', 'unknown')) AS v(n, t)
WHERE NOT EXISTS (SELECT 1 FROM public.company_employee_tiers t WHERE lower(t.company_name) = lower(v.n));
