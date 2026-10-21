-- Karim signed off the 8 original countries' job-function lists
-- (2026-10-21, on the sign-off page built from the previews in
-- 20261021090000_index_original_countries_preview.sql).
--
-- Their industry rankings stay on the earlier collection
-- (overview_source = 'legacy'); only the job-function lists go public.
-- Refresh afterwards by hand: docs/RUNBOOK_AFTER_COLLECTION.md, Index steps 2 to 5.

-- TPG is the investment firm (about 1,900 staff, FY2025), not a 50,000+
-- employer, so it drops below the Index's size bar. The earlier row is in
-- company_employee_tiers_backup_20261021.
UPDATE public.company_employee_tiers
SET estimated_tier = '500-4999', confidence = 'high', classified_by = 'manual', classified_at = now()
WHERE lower(company_name) = 'tpg';

UPDATE public.index_country_status
SET job_functions_published = true,
    note = 'Original country; job functions signed off 2026-10-21',
    updated_at = now()
WHERE country IN ('Brazil', 'China', 'France', 'Germany', 'India',
                  'United Arab Emirates', 'United Kingdom', 'United States')
  AND NOT job_functions_published;
