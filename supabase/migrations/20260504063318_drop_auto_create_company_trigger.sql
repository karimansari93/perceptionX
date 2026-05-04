-- Drop the auto_create_company trigger on user_onboarding.
--
-- This trigger fired on every user_onboarding insert and auto-spawned an
-- "X's Organization" + a Company + memberships. Onboarding has been
-- retired (users are provisioned by admins), and the cascade was
-- creating phantom orgs every time anything inserted to user_onboarding —
-- including backfill scripts, which spawned 6 empty NVIDIA companies in
-- a phantom org during demo setup.

DROP TRIGGER IF EXISTS auto_create_company_trigger ON public.user_onboarding;
DROP FUNCTION IF EXISTS public.auto_create_company_from_onboarding();
