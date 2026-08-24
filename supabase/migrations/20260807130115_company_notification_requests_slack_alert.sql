-- Recovered verbatim from supabase_migrations.schema_migrations.
-- Applied to production as migration version 20260807130115; this file was
-- back-filled afterwards and therefore post-dates the deployment.

-- Slack alert for new rows in company_notification_requests ("notify me about
-- this company" requests from the public site).
--
-- Previously handled by trigger "make2", a dashboard-created database webhook
-- posting to a Make.com scenario (hook.eu2.make.com/sr9…) whose Slack leg went
-- silent — requests from Jan/Feb/May 2026 produced no notification. Replaced
-- here with the in-house alert pipeline already used by intake_submit and the
-- batch-queue watchdog: send_batch_alert() → send-batch-alert edge function →
-- BATCH_ALERTS_SLACK_WEBHOOK.
--
-- Fire-and-forget: a Slack outage (or unconfigured webhook) must never fail
-- the public site's insert. The insert comes from an untrusted public form,
-- so user-supplied values are escaped for Slack mrkdwn (& < >) and truncated
-- before being embedded in the message.

create or replace function public.notify_company_notification_request()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_company text;
  v_email text;
  v_industry text;
begin
  v_company  := left(coalesce(nullif(trim(new.company_name), ''), '—'), 200);
  v_email    := left(coalesce(nullif(trim(new.email), ''), '—'), 200);
  v_industry := left(coalesce(nullif(trim(new.industry), ''), '—'), 200);

  -- Escape Slack mrkdwn control characters in user input (& first).
  v_company  := replace(replace(replace(v_company,  '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_email    := replace(replace(replace(v_email,    '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_industry := replace(replace(replace(v_industry, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  begin
    perform public.send_batch_alert(jsonb_build_object(
      'event', 'custom',
      'title', '🏢 New company notification request',
      'text', '*' || v_company || '* was requested on the public site.',
      'fields', jsonb_build_array(
        jsonb_build_object('label', 'Company', 'value', v_company),
        jsonb_build_object('label', 'Email', 'value', v_email),
        jsonb_build_object('label', 'Industry', 'value', v_industry)
      )
    ));
  exception when others then
    raise notice 'notify_company_notification_request: slack alert failed: %', sqlerrm;
  end;

  return new;
end $$;

drop trigger if exists company_notification_request_slack_alert
  on public.company_notification_requests;

create trigger company_notification_request_slack_alert
  after insert on public.company_notification_requests
  for each row execute function public.notify_company_notification_request();

-- Retire the dead Make.com webhook so a revived scenario can't double-post.
drop trigger if exists make2 on public.company_notification_requests;
