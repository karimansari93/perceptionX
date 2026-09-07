-- =============================================================================
-- In-app "Ask AI" chat: request log, per-org daily cap, starter-question
-- cache, and per-message sources.
--
--   * chat_request_log — one row per chat-with-data request (org, user, the
--     tools the model called, rounds, tokens, duration, error). Written by the
--     edge function via the service role; the per-org daily cap counts it.
--     Same shape and RLS posture as mcp_request_log.
--   * chat_org_settings — optional per-org row: daily cap (default 300 when no
--     row exists), an enabled switch, and the cached starter questions (built
--     from px-tools data, refreshed at most once a day).
--   * chat_messages.sources — the {title, url, domain} pages the tools
--     returned for an assistant turn, so the UI can render a sources footer
--     from data when a conversation is reopened.
-- Additive only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_request_log (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts                timestamptz NOT NULL DEFAULT now(),
    organization_id   uuid,
    user_id           uuid,
    conversation_id   uuid,
    model             text,
    tool_names        text[] NOT NULL DEFAULT '{}',
    rounds            integer NOT NULL DEFAULT 0,
    input_tokens      integer,
    output_tokens     integer,
    cache_read_tokens integer,
    first_token_ms    integer,      -- time to first streamed text token
    duration_ms       integer,
    status            text,          -- ok | refusal | rate_limited | error
    error             text
);
CREATE INDEX IF NOT EXISTS chat_request_log_org_ts_idx  ON public.chat_request_log (organization_id, ts DESC);
CREATE INDEX IF NOT EXISTS chat_request_log_user_ts_idx ON public.chat_request_log (user_id, ts DESC);

CREATE TABLE IF NOT EXISTS public.chat_org_settings (
    organization_id       uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    enabled               boolean NOT NULL DEFAULT true,
    daily_cap             integer NOT NULL DEFAULT 300,
    starter_questions     jsonb,
    starters_generated_at timestamptz,
    notes                 text,
    created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sources jsonb;

-- RLS: service-role writes; admin-only SELECT for SQL-editor inspection.
ALTER TABLE public.chat_request_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_org_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_request_log','chat_org_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING ((SELECT public.is_admin()))',
      t || '_admin_select', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
