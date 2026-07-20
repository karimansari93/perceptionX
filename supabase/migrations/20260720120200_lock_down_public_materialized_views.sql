-- Lock down the six anon-readable materialized views.
--
-- Materialized views cannot carry RLS, so anything exposed to `anon` is
-- readable by anyone holding the public anon key. The app has no public
-- (logged-out) data pages -- every route is behind auth or a tokenized
-- onboarding flow -- so `anon` never needs these. Logged-in users use the
-- `authenticated` role; scheduled refresh jobs run as the object owner.
--
-- NOTE (follow-up): these MVs are still readable across tenants by ANY
-- authenticated user, because MVs can't enforce RLS. Wrapping them behind
-- RLS-protected views or SECURITY DEFINER RPCs is a larger, separate change.

-- Per-company analytics consumed by the authenticated dashboard/search:
-- keep authenticated + service_role, drop anon/public.
revoke select on public.company_sentiment_scores_by_location_mv from anon, public;
grant  select on public.company_sentiment_scores_by_location_mv to authenticated, service_role;

revoke select on public.company_visibility_by_location_mv from anon, public;
grant  select on public.company_visibility_by_location_mv to authenticated, service_role;

revoke select on public.company_search_index from anon, public;
grant  select on public.company_search_index to authenticated, service_role;

revoke select on public.rankings_overview from anon, public;
grant  select on public.rankings_overview to authenticated, service_role;

revoke select on public.rankings_historical from anon, public;
grant  select on public.rankings_historical to authenticated, service_role;

-- Internal ops only (crawler dead-domain cache): no app consumer at all.
revoke select on public.firecrawl_dead_domains from anon, authenticated, public;
grant  select on public.firecrawl_dead_domains to service_role;
