-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260506082001; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- This trigger was auto-filling confirmed_prompts.company_id from the
-- user's default company_members row. company_members is retired and
-- the org model now requires explicit company_id at insert time
-- (set by the calling code), so this trigger is both obsolete and
-- broken: it ERRORs with "relation company_members does not exist".

DROP TRIGGER IF EXISTS auto_link_prompts_trigger ON public.confirmed_prompts;
DROP FUNCTION IF EXISTS public.auto_link_prompts_to_company();
