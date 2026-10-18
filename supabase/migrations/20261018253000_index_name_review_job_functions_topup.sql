-- Top-up after the first job-function rankings: 87 unlabelled names had moved
-- into 50 of the 2,250 top 10s (labelled companies below 5,000 staff dropped
-- out). Same review flow; hand-reviewed below.
SELECT public.apply_index_name_review(
  ARRAY['Air Canada Engineering', 'Air Canada Pilot Academy', 'Bon Secours Hospital',
        'Sotheby''S International Realty Australia', 'Saudia Flight Training => Saudia',
        'Balder Egendom => Balder Fastigheter', 'Balder Sverige => Balder Fastigheter',
        'Frasers Property Industrial => Frasers Property']::text[],
  ARRAY['A3', 'A320neo', 'Airlinepilotcentral', 'Basel', 'Jobbnorge.No', 'Lokalbolig',
        'Medical Device Companies', 'Booli', 'Monster', 'Jai']::text[]);

-- Member bodies, not large employers: the model gave them 5,000+.
UPDATE public.company_employee_tiers
SET estimated_tier = v.tier, confidence = 'medium', classified_by = 'manual', classified_at = now()
FROM (VALUES ('air canada pilots association', '50-499'), ('japanese nursing association', '500-4999')) AS v(name, tier)
WHERE lower(company_name) = v.name;
