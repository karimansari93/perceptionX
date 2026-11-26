-- Advanced Personnel Management: website (drives the logo) and owned domains
-- (drives owned vs third-party sources). Domain given by Karim, 2026-11-26.
update public.companies
set website = 'apm.net.au'
where id = '229b40e5-812c-4d4f-af39-7254f137ac66' and website is null;

insert into public.company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
select '229b40e5-812c-4d4f-af39-7254f137ac66', d.domain, d.asset_type, false, 'Added for APM demo, 2026-11-26'
from (values ('apm.net.au', 'corporate'), ('careers.apm.net.au', 'careers')) d(domain, asset_type)
where not exists (
  select 1 from public.company_owned_domains o
  where o.company_id = '229b40e5-812c-4d4f-af39-7254f137ac66' and lower(o.domain) = d.domain
);
