-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260729100604; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Actions are org-scoped, not company-scoped.
--
-- A client org holds one company row per market (Netflix has 19: US, DE, JP,
-- KR, ... plus Animation Studios and Eyeline). The quarterly report spans all
-- of them, and the market a recommendation applies to is already captured in
-- markets[]. Scoping rows to a single company_id would hide the Germany action
-- from anyone viewing the US profile.
--
-- company_id stays as an OPTIONAL pin, for the rare action that genuinely
-- concerns one profile only. Reads scope on organization_id.

ALTER TABLE public.company_actions ALTER COLUMN company_id DROP NOT NULL;

DROP INDEX IF EXISTS public.uniq_company_actions_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_actions_key
  ON public.company_actions(organization_id, key);

DROP INDEX IF EXISTS public.idx_company_actions_company_published;
CREATE INDEX IF NOT EXISTS idx_company_actions_org_published
  ON public.company_actions(organization_id, published_at);

COMMENT ON COLUMN public.company_actions.company_id IS
  'Optional pin to a single company profile. Normally NULL: actions are org-scoped because a report spans every market profile in the org, and the applicable market lives in markets[].';
