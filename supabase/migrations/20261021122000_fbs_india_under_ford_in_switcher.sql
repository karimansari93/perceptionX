-- Ford > India in the dashboard switcher opens Ford Business Solutions India
-- (Karim, 2026-10-21). Follows 20261021121000, which unlinked Ford India.
--
-- CompanySwitcher groups by settings.switcher_brand when set, else by name.
-- The company keeps its name, so mention detection and the dashboard's brand
-- scope (same-name siblings) stay FBS-only. Previous settings: {}.

update public.companies
set settings = coalesce(settings, '{}'::jsonb) || '{"switcher_brand": "Ford"}'::jsonb
where id = '6013cdc4-5936-4436-86fe-852382469f94';
