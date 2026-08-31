-- =============================================================================
-- MCP server auth layer — OAuth 2.1 authorization server state, org-scoped
-- tokens, per-org enablement/quotas, and the request audit log.
--
-- Design notes:
--   * Everything here is written/read by the `mcp-server` edge function via
--     the service role. RLS is enabled with an admin-only SELECT policy so
--     platform admins can inspect state from the SQL editor; no client-side
--     path exists or should exist.
--   * Tokens are NEVER stored raw — sha256 hex only. The raw value is shown
--     exactly once (mcp_create_api_key return / token endpoint response).
--   * mcp_org_settings is an explicit allowlist: no row (or enabled=false)
--     means MCP access is OFF for that org. Rollout is per-client on purpose.
--   * Additive only: no existing table is touched.
-- =============================================================================

-- ── OAuth clients (RFC 7591 dynamic registration) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
    client_id                  text PRIMARY KEY,
    client_name                text,
    redirect_uris              jsonb NOT NULL DEFAULT '[]'::jsonb,
    token_endpoint_auth_method text NOT NULL DEFAULT 'none',
    registration_meta          jsonb,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

-- ── Pending /authorize requests (bridge to the app consent page) ────────────
CREATE TABLE IF NOT EXISTS public.mcp_oauth_requests (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id             text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
    redirect_uri          text NOT NULL,
    scope                 text NOT NULL DEFAULT 'perceptionx:read',
    state                 text,
    code_challenge        text NOT NULL,
    code_challenge_method text NOT NULL DEFAULT 'S256',
    resource              text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    expires_at            timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
    consumed_at           timestamptz
);

-- ── Single-use authorization codes ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_auth_codes (
    code_hash       text PRIMARY KEY,
    client_id       text NOT NULL,
    redirect_uri    text NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL,
    scope           text NOT NULL DEFAULT 'perceptionx:read',
    code_challenge  text NOT NULL,
    resource        text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
    used_at         timestamptz
);

-- ── Tokens: access, refresh, and PATs in one table (one-lookup validation) ──
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash      text NOT NULL UNIQUE,
    kind            text NOT NULL CHECK (kind IN ('access', 'refresh', 'pat')),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         uuid,
    client_id       text,
    name            text,
    scope           text NOT NULL DEFAULT 'perceptionx:read',
    -- rotation lineage: a refreshed pair points at the refresh token it came
    -- from, so a replayed old refresh token can revoke the whole family.
    parent_id       uuid REFERENCES public.mcp_tokens(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    revoked_at      timestamptz,
    last_used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_tokens_org_idx ON public.mcp_tokens (organization_id, kind);

-- ── Per-org enablement + quotas (explicit allowlist) ────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_org_settings (
    organization_id  uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    enabled          boolean NOT NULL DEFAULT true,
    per_minute_limit integer NOT NULL DEFAULT 60,
    daily_quota      integer NOT NULL DEFAULT 2000,
    notes            text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Audit log: who asked what, which org, which tool, how it went ───────────
CREATE TABLE IF NOT EXISTS public.mcp_request_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts              timestamptz NOT NULL DEFAULT now(),
    organization_id uuid,
    token_id        uuid,
    token_kind      text,
    method          text,
    tool_name       text,
    args            jsonb,
    status          text,
    error           text,
    duration_ms     integer,
    client_info     text
);
CREATE INDEX IF NOT EXISTS mcp_request_log_token_ts_idx ON public.mcp_request_log (token_id, ts DESC);
CREATE INDEX IF NOT EXISTS mcp_request_log_org_ts_idx   ON public.mcp_request_log (organization_id, ts DESC);

-- ── RLS: service-role writes; admin-only SELECT for SQL-editor inspection ───
ALTER TABLE public.mcp_oauth_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_auth_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_org_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_request_log    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_oauth_clients','mcp_oauth_requests','mcp_auth_codes',
                           'mcp_tokens','mcp_org_settings','mcp_request_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING ((SELECT public.is_admin()))',
      t || '_admin_select', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ── Admin RPCs (actions-register style: no UI, run from SQL editor) ─────────

-- Privilege check shared by the admin RPCs: platform admins (user_roles) and
-- the service role (the mcp-server edge function) pass; direct SQL-editor
-- sessions (no request claims at all) pass; everyone else is rejected.
CREATE OR REPLACE FUNCTION public.mcp_caller_is_privileged()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
      OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role';
$$;

-- Mint an org-scoped Personal Access Token. Returns the RAW key exactly once.
-- PATs serve MCP clients that support static bearer headers (Claude Code,
-- server-side scripts) and our own smoke tests; ChatGPT uses the OAuth flow.
CREATE OR REPLACE FUNCTION public.mcp_create_api_key(
    p_organization_id uuid,
    p_name text,
    p_expires_in_days integer DEFAULT NULL
)
RETURNS TABLE (key_id uuid, api_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_raw  text;
    v_hash text;
    v_id   uuid;
BEGIN
    IF NOT public.mcp_caller_is_privileged() THEN
        RAISE EXCEPTION 'admin only';
    END IF;
    v_raw  := 'pxk_' || replace(replace(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_');
    v_hash := encode(extensions.digest(v_raw, 'sha256'), 'hex');
    INSERT INTO public.mcp_tokens (token_hash, kind, organization_id, name, expires_at)
    VALUES (v_hash, 'pat', p_organization_id, p_name,
            CASE WHEN p_expires_in_days IS NULL THEN NULL ELSE now() + make_interval(days => p_expires_in_days) END)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, v_raw;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_revoke_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.mcp_caller_is_privileged() THEN
        RAISE EXCEPTION 'admin only';
    END IF;
    UPDATE public.mcp_tokens SET revoked_at = now()
    WHERE id = p_token_id OR parent_id = p_token_id;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_enable_org(
    p_organization_id uuid,
    p_per_minute integer DEFAULT 60,
    p_daily integer DEFAULT 2000,
    p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.mcp_caller_is_privileged() THEN
        RAISE EXCEPTION 'admin only';
    END IF;
    INSERT INTO public.mcp_org_settings (organization_id, enabled, per_minute_limit, daily_quota, notes)
    VALUES (p_organization_id, true, p_per_minute, p_daily, p_notes)
    ON CONFLICT (organization_id) DO UPDATE
        SET enabled = true, per_minute_limit = EXCLUDED.per_minute_limit,
            daily_quota = EXCLUDED.daily_quota,
            notes = COALESCE(EXCLUDED.notes, mcp_org_settings.notes);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_disable_org(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.mcp_caller_is_privileged() THEN
        RAISE EXCEPTION 'admin only';
    END IF;
    UPDATE public.mcp_org_settings SET enabled = false WHERE organization_id = p_organization_id;
END $$;

-- Admin + service_role may execute; the `current_setting IS NOT NULL` arm
-- means: JWT-bearing callers must be admins, while the service role (no
-- request claims) passes — the edge function is trusted.
REVOKE ALL ON FUNCTION public.mcp_create_api_key(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_revoke_token(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_enable_org(uuid, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_disable_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_caller_is_privileged() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_create_api_key(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_revoke_token(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_enable_org(uuid, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_disable_org(uuid) TO authenticated, service_role;
