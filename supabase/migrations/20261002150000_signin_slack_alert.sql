-- Post to the #users Slack channel whenever someone signs in to the app,
-- except Karim, Andy, Rodrigo (including Karim's client-domain test accounts
-- such as karim@ford.com and karim+anything@...) and the shared demo and
-- AI-reviewer accounts.
--
-- Fires on auth.users.last_sign_in_at, which Supabase Auth sets on every real
-- sign-in and not on token refresh, so one sign-in means one message. A
-- second change within 10 minutes is skipped to avoid double posts.
--
-- Fire-and-forget via pg_net to the signin-alert edge function. Any failure
-- is swallowed: a Slack problem must never block a sign-in.

create or replace function public.is_internal_signin_email(p_email text)
returns boolean
language sql immutable
as $$
  select
    -- Karim: karim@<any domain>, karim+<tag>@<any domain>, personal accounts
    split_part(lower(p_email), '@', 1) = 'karim'
    or split_part(lower(p_email), '@', 1) like 'karim+%'
    or lower(p_email) like 'karimansari93@%'
    or lower(p_email) = 'akarimdaa@gmail.com'
    -- Andy
    or lower(p_email) in ('andy@perceptionx.ai', 'andy@andypartridge.co.uk')
    or lower(p_email) like 'andy+%@perceptionx.ai'
    -- Rodrigo
    or lower(p_email) = 'rodrigo.furusawa@gmail.com'
    or lower(p_email) like 'rodrigo%@perceptionx.ai'
    -- Shared demo and AI-reviewer accounts
    or lower(p_email) in ('demo@perceptionx.ai', 'anthropic-reviewer@perceptionx.ai', 'openai-reviewer@perceptionx.ai')
$$;

create or replace function public.notify_signin_slack()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_project_url text;
  v_service_key text;
begin
  if new.last_sign_in_at is null
     or new.last_sign_in_at is not distinct from old.last_sign_in_at
     or (old.last_sign_in_at is not null and new.last_sign_in_at - old.last_sign_in_at < interval '10 minutes')
     or new.email is null
     or public.is_internal_signin_email(new.email) then
    return new;
  end if;

  begin
    select decrypted_secret into v_project_url from vault.decrypted_secrets where name = 'supabase_url';
    select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_project_url is null or v_service_key is null then
      raise notice 'notify_signin_slack: missing vault secret, skipping';
      return new;
    end if;

    perform net.http_post(
      url := v_project_url || '/functions/v1/signin-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'user_id', new.id,
        'first_sign_in', old.last_sign_in_at is null
      )
    );
  exception when others then
    raise notice 'notify_signin_slack: failed: %', sqlerrm;
  end;

  return new;
end $$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row execute function public.notify_signin_slack();
