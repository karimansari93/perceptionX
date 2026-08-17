-- "What are you up for?" — the recipient picks which kinds of contribution
-- they're open to (review / forum / social) as the last question, and the
-- payoff page shows only those. Skipping shows everything, so this narrows
-- the page without ever withholding a route.
--
-- Stored because the share of people willing to leave a review at all is a
-- more honest read on appetite than click counts, and it costs one column.
-- Values are constrained to the three known channels in the RPC below.
--
-- Applied to production via MCP on 2026-08-15; activate_log_event gains a
-- p_channels text[] parameter, validated against ('review','forum','social')
-- and capped at three entries. Function body otherwise unchanged from
-- 20260811180000.
alter table public.activate_link_events
  add column if not exists declared_channels text[];
