-- Security hardening (part 2 of 2)
--
-- Removes the legacy admin flag now that authorization lives in user_roles.
-- Safe only after:
--   * 20260720120000_harden_auth_and_rls.sql has run (is_admin() reads user_roles), and
--   * the send-intake-invite edge function has been redeployed to read user_roles.
alter table public.profiles drop column if exists is_admin;
