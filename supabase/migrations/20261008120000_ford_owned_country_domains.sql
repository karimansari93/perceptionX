-- Official Ford country domains for company_owned_domains (Ford has none on file).
-- Each domain is added only to the Ford, Ford Credit and Ford Business Solutions
-- records for its own country. Re-runnable: existing (company_id, domain) pairs are skipped.
-- Dry run 2026-10-08: 34 rows (21 domains across 28 company records). Pending Karim's sign-off.
insert into company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
select c.id, d.domain, 'regional', false, d.notes
from companies c
join (values
  ('AR','ford.com.ar','Argentina'),
  ('AU','ford.com.au','Australia'),
  ('BE','fr.ford.be','Belgium French-language site'),
  ('BE','nl.ford.be','Belgium Dutch-language site'),
  ('BR','ford.com.br','Brazil'),
  ('CA','ford.ca','Canada'),
  ('CA','fr.ford.ca','Canada French-language site'),
  ('CL','ford.cl','Chile'),
  ('CO','ford.com.co','Colombia'),
  ('FR','ford.fr','France'),
  ('DE','ford.de','Germany'),
  ('HU','ford.hu','Hungary'),
  ('IN','india.ford.com','India'),
  ('MX','ford.mx','Mexico'),
  ('PE','ford.pe','Peru'),
  ('RO','ford.ro','Romania'),
  ('ES','ford.es','Spain'),
  ('GB','ford.co.uk','United Kingdom'),
  ('US','ford.com','United States'),
  ('US','es.ford.com','United States Spanish-language site'),
  ('VE','ford.com.ve','Venezuela')
) as d(iso, domain, notes) on d.iso = c.country
where c.name in ('Ford','Ford Business Solutions','Ford Credit') and length(c.name) >= 3
on conflict (company_id, domain) do nothing;
