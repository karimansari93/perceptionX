-- Fixes from scanning the 8 original countries' preview top 10s by hand
-- (102 names that appear in no live Index list). Country units and renamed
-- companies join their parent; bodies that are not employers (unions,
-- regulators, associations, a building, universities) are excluded, as
-- elsewhere on the Index.

SELECT public.index_fold_entry(f, t, true)
FROM (VALUES
  ('Centaline Property', 'Centaline'),
  ('HDFC AMC', 'HDFC Asset Management'),
  ('Hill''s', 'Hill''s Pet Nutrition'),
  ('Hills Pet Nutrition', 'Hill''s Pet Nutrition'),
  ('Hospital Das Clínicas Da Faculdade De Medicina Da Usp', 'Hospital das Clínicas'),
  ('Vivalto', 'Vivalto Santé'),
  ('Bdo France', 'BDO'),
  ('Ea Uk', 'Electronic Arts'),
  ('Kpmg Germany', 'KPMG'),
  ('Rockstar Games India', 'Rockstar Games'),
  ('Ubisoft Mumbai', 'Ubisoft'),
  ('Brookfield Brasil', 'Brookfield'),
  ('Stc Solutions', 'STC'),
  ('Al Ghurair Foods', 'Al Ghurair'),
  ('Etihad Airport Services', 'Etihad'),
  ('Unitymedia', 'Vodafone'),          -- bought by Vodafone in 2019
  ('Sosh', 'Orange'),                  -- Orange's low-cost brand
  ('Dianping', 'Meituan'),
  ('Rewe Digital', 'Rewe'),
  ('Sncf Connect', 'SNCF'),
  ('Itaú BBA', 'Itaú'),
  ('Boehringer Ingelheim Animal Health', 'Boehringer Ingelheim'),
  ('Générale De Santé', 'Ramsay Santé')  -- renamed in 2017
) AS v(f, t);

INSERT INTO public.company_overrides (canonical_name, status, exclusion_reason, notes)
SELECT n, 'excluded', 'not_a_company', 'Not an employer (8 original countries, preview check, 2026-10-21)'
FROM unnest(ARRAY[
  'Airline Pilots'' Association', 'Care Quality Commission', 'Royal College Of Nursing', 'NIHR',
  'Emirates Veterinary Association', 'Women In Aviation International', 'Emirates Towers',
  'Emirates Aviation College', 'Unifesp', 'The Veterinary Hospital'
]) AS n
WHERE NOT EXISTS (SELECT 1 FROM public.company_overrides o WHERE lower(o.canonical_name) = lower(n));
