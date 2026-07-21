-- Onboarding links now default to a 30-day lifetime (was 14): two weeks proved
-- shorter than a real enterprise client's attention cycle, and expiry never
-- deletes anything — admins can also extend any link from the Onboarding Forms
-- tab. Existing invites keep their current expires_at.
alter table public.intake_invites
  alter column expires_at set default now() + interval '30 days';
