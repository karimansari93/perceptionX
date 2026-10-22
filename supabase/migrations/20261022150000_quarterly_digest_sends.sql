-- quarterly_digest_sends
-- ----------------------
-- One row per quarterly update email sent to a member: who, which period,
-- the payload the email was rendered from (every figure and the prose), the
-- Resend id and the pre-created chat thread the button opens. Written by the
-- quarterly-digest edge function (service role); read by platform admins.

create table if not exists public.quarterly_digest_sends (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid references public.organization_members(id) on delete set null,
  user_id         uuid not null,
  email           text not null,
  period          text not null,
  subject         text not null,
  payload         jsonb not null,
  resend_id       text,
  conversation_id uuid,
  sent_by         uuid,
  status          text not null default 'sent',
  created_at      timestamptz not null default now()
);

create index if not exists quarterly_digest_sends_org_period_idx
  on public.quarterly_digest_sends (organization_id, period, created_at desc);

alter table public.quarterly_digest_sends enable row level security;

drop policy if exists "quarterly_digest_sends_admin_read" on public.quarterly_digest_sends;
create policy "quarterly_digest_sends_admin_read"
  on public.quarterly_digest_sends for select
  using (public.is_admin());

comment on table public.quarterly_digest_sends is
  'Quarterly update emails sent to organization members, with the rendered payload for the record.';
