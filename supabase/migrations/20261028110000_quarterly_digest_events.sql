-- quarterly_digest_events
-- -----------------------
-- Delivery events from Resend for the quarterly update email: delivered,
-- opened, clicked, bounced, complained, one row per event, matched to the
-- send by the Resend message id. Written by the resend-events edge function
-- (service role); read by platform admins. svix_id is Resend's delivery id,
-- unique so a retried delivery is stored once.
create table if not exists public.quarterly_digest_events (
  id        uuid primary key default gen_random_uuid(),
  send_id   uuid not null references public.quarterly_digest_sends(id) on delete cascade,
  resend_id text not null,
  type      text not null,
  link      text,
  event_at  timestamptz not null,
  svix_id   text not null unique,
  raw       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quarterly_digest_events_send_idx
  on public.quarterly_digest_events (send_id, type, event_at);
create index if not exists quarterly_digest_sends_resend_id_idx
  on public.quarterly_digest_sends (resend_id);
alter table public.quarterly_digest_events enable row level security;
drop policy if exists "quarterly_digest_events_admin_read" on public.quarterly_digest_events;
create policy "quarterly_digest_events_admin_read"
  on public.quarterly_digest_events for select
  using (public.is_admin());
comment on table public.quarterly_digest_events is
  'Resend delivery events (delivered, opened, clicked, bounced, complained) for quarterly update emails.';
