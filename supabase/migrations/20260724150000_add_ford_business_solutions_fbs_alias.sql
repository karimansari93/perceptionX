-- Ford Business Solutions was showing low visibility because AI responses very
-- often refer to the company by its abbreviation "FBS" (e.g. "FBS recently
-- launched its third technology center in Coimbatore"), which the literal
-- company-name substring match in analyze-response never catches. At the time
-- of this migration 21 of 569 not-mentioned responses referred to the company
-- as FBS with no full-name spelling anywhere in the text.
--
-- Word-boundary regex (same approach as the WBD aliases in
-- 20260610082853_add_match_type_and_wbd_mention_aliases.sql) so we don't match
-- "fbs" inside longer tokens. Bare "Ford" is deliberately NOT aliased: it is
-- ambiguous with Ford Motor Company (the parent), mirroring how the WBD seed
-- excluded bare "Discovery"/"Max".
--
-- Historical rows are fixed by the companion backfill
-- (scripts/backfill-company-mentioned-aliases.sql); new rows are covered
-- automatically by the apply_company_mention_aliases() trigger.

insert into public.company_mention_aliases (company_name, alias, match_type, locale, notes) values
  ('Ford Business Solutions', '\mFBS\M', 'regex', null, 'FBS abbreviation of Ford Business Solutions')
on conflict (lower(company_name), lower(alias)) do nothing;
