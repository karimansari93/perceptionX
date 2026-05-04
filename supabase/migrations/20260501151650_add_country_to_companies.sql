-- Move country off user_onboarding (per-user) onto companies (per-company)
-- where it logically belongs. user_onboarding is being retired; country
-- needs a canonical home that's RLS-friendly for org-shared companies.
--
-- Backfills from the most recent user_onboarding row per company.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS country text;

UPDATE public.companies c
SET country = sub.country
FROM (
  SELECT DISTINCT ON (uo.company_id) uo.company_id, uo.country
  FROM public.user_onboarding uo
  WHERE uo.company_id IS NOT NULL AND uo.country IS NOT NULL
  ORDER BY uo.company_id, uo.created_at DESC
) sub
WHERE c.id = sub.company_id AND c.country IS NULL;
