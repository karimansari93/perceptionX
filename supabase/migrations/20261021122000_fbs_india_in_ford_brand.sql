-- Ford > India is Ford Business Solutions India (Karim, 2026-10-21).
-- Follows 20261021121000, which unlinked Ford India.
--
-- settings.brand_name puts FBS India in the Ford brand (brandOf in
-- CompanyContext): the company switcher lists it as Ford > India, and the
-- dashboard's brand scope includes it, so Ford's location filter offers India
-- and "All locations" aggregates it as it did Ford India. The company keeps
-- its name, so mention detection still looks for Ford Business Solutions.
-- Previous settings: {}.

update public.companies
set settings = coalesce(settings, '{}'::jsonb) || '{"brand_name": "Ford"}'::jsonb
where id = '6013cdc4-5936-4436-86fe-852382469f94';
