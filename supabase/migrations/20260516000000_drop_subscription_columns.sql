-- Drop the legacy free/pro subscription model entirely.
--
-- DEPLOY ORDERING (important — this migration is destructive):
-- Apply ONLY AFTER the frontend Pro-removal PR (branch
-- claude/magical-taussig-a8bc29) is merged AND deployed, and after the
-- collect-company-responses edge function in this PR is deployed. Until
-- then, src/ still reads profiles.subscription_type / prompts_used /
-- subscription_start_date and dropping these columns would break runtime.
-- A repo-wide grep (excluding src/integrations/supabase/types) must show
-- zero references before this runs.
--
-- The auto_create_company_from_onboarding() per-tier company limit was
-- already removed by 20260504063318_drop_auto_create_company_trigger.sql
-- (function + trigger dropped) and 20260504070001_drop_user_onboarding.sql
-- (table dropped), so no further per-tier limit migration is needed.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS subscription_type,
  DROP COLUMN IF EXISTS subscription_start_date,
  DROP COLUMN IF EXISTS prompts_used;

-- idx_profiles_subscription_type is dropped automatically with the column.

DROP TYPE IF EXISTS subscription_type;
