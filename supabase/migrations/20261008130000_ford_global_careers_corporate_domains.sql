-- Global Ford careers and corporate domains for every Ford country record
-- (not Ford Credit or Ford Business Solutions). Re-runnable.
insert into company_owned_domains (company_id, domain, asset_type, is_auto_detected, notes)
select c.id, d.domain, d.asset_type, false, d.notes
from companies c
cross join (values
  ('careers.ford.com','careers','Global careers site'),
  ('corporate.ford.com','corporate','Global corporate site')
) as d(domain, asset_type, notes)
where c.name = 'Ford' and length(c.name) >= 3
on conflict (company_id, domain) do nothing;
