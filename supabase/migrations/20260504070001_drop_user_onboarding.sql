-- Drop user_onboarding. Onboarding flow is retired (users are
-- provisioned by admins); country has been moved to companies; the
-- auto_create_company trigger has been dropped; client writers have
-- been neutralised.
--
-- IMPORTANT: this is the most invasive of the cleanup migrations.
-- Apply ONLY after running the audit in step #6 of the migration plan
-- to confirm no production code path still reads user_onboarding for
-- a critical feature. There are ~40 reads in src/ at the time of
-- writing — most are graceful-fallback paths but a few may still gate
-- features for admin-provisioned users.
--
-- Recommendation: deploy with the table renamed first (see commented
-- block below) for a 24-48h soak; if nothing breaks, then DROP for real.

-- Soak option: comment the DROP, uncomment the rename.
-- ALTER TABLE public.user_onboarding RENAME TO user_onboarding_retired;

DROP TABLE IF EXISTS public.user_onboarding CASCADE;
