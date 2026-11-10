-- Remove the hand-entered review counts added in 20261110120000.
--
-- Karim, 2026-11-10: no manual steps in admin. Nothing ever read or wrote
-- these outside the admin screen that is now removed, and the table was empty
-- when dropped. Page signals (amplify_page_events, amplify_log_event,
-- admin_amplify_link_insights) stay.

drop function if exists public.admin_amplify_weekly_clicks(uuid);
drop table if exists public.activate_review_snapshots;
