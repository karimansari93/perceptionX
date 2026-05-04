-- Drop company_members. RLS unification migrated all per-company access
-- to organization_members; this table is fully retired.
--
-- IMPORTANT: apply this migration AFTER deploying edge function updates
-- that strip company_members references (manage-company-search-terms,
-- admin-add-candidate-prompts, process-company-batch-queue,
-- admin-upgrade-user, search-insights). If applied while old edge
-- function code is live, those functions will throw 500s.

DROP TABLE IF EXISTS public.company_members CASCADE;
