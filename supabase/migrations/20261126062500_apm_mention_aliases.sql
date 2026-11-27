-- Advanced Personnel Management (APM Group, Australia): count short name and
-- physio brand as APM.
--
-- Found 2026-11-26 on the first APM demo collection (Australia, Physiotherapist,
-- ChatGPT). analyze-response matches the literal company name
-- ("Advanced Personnel Management"), but answers say "APM" / "APM Group" or
-- name Lifecare (APM's Australian physiotherapy network). Those answers were
-- stored with company_mentioned = false. Approved by Karim in session.
--
-- Fix: regex aliases in company_mention_aliases (the BEFORE INSERT/UPDATE
-- trigger applies them to every new response) plus a backfill scoped to APM's
-- company_id. Backfill only ever sets false -> true.

insert into public.company_mention_aliases (company_name, alias, match_type, locale, notes) values
  ('Advanced Personnel Management', '\mAPM\M',      'regex', null, 'Short name: APM / APM Group'),
  ('Advanced Personnel Management', '\mLifecare\M', 'regex', null, 'Lifecare, APM physiotherapy network in Australia')
on conflict (lower(company_name), lower(alias)) do nothing;

update public.prompt_responses pr
set company_mentioned = true
where pr.company_id = '229b40e5-812c-4d4f-af39-7254f137ac66'
  and coalesce(pr.company_mentioned, false) = false
  and (pr.response_text ~* '\mAPM\M' or pr.response_text ~* '\mLifecare\M');
