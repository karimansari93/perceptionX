-- MCP: confidential OAuth clients, for hosts that cannot self-register.
--
-- Gemini Enterprise's "Custom MCP Server" data store supports neither dynamic
-- client registration nor OAuth discovery: the customer's Google admin types
-- in a client ID, a client secret, and our authorize and token URLs. This
-- migration lets a platform admin mint such a client:
--
--   * client_secret_hash: sha256 hex of the secret (raw secret shown once).
--   * organization_id: when set, the consent page offers only that
--     organization and /authorize/approve refuses any other, so a client
--     issued to one customer can never connect another customer's data.
--   * PKCE becomes optional for confidential clients only (Google's connector
--     may not send it). Public clients (ChatGPT, Claude, DCR, CIMD) still
--     require S256; the edge function enforces that.
--
-- Mint one from the SQL editor (raw secret returned exactly once):
--   select * from mcp_create_confidential_client(
--     'Gemini Enterprise (Netflix)',
--     '["<redirect URI from Google''s setup page>"]'::jsonb,
--     '<organization uuid>');

ALTER TABLE public.mcp_oauth_clients
    ADD COLUMN IF NOT EXISTS client_secret_hash text,
    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.mcp_oauth_requests ALTER COLUMN code_challenge DROP NOT NULL;
ALTER TABLE public.mcp_auth_codes     ALTER COLUMN code_challenge DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.mcp_create_confidential_client(
    p_client_name text,
    p_redirect_uris jsonb,
    p_organization_id uuid
)
RETURNS TABLE (client_id text, client_secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id     text;
    v_secret text;
    v_uri    text;
BEGIN
    IF NOT public.mcp_caller_is_privileged() THEN
        RAISE EXCEPTION 'admin only';
    END IF;
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'a confidential client must be bound to one organization';
    END IF;
    IF jsonb_typeof(p_redirect_uris) <> 'array' OR jsonb_array_length(p_redirect_uris) = 0 THEN
        RAISE EXCEPTION 'redirect_uris must be a non-empty JSON array';
    END IF;
    FOR v_uri IN SELECT jsonb_array_elements_text(p_redirect_uris) LOOP
        IF v_uri !~ '^https://' THEN
            RAISE EXCEPTION 'redirect URI must be https: %', v_uri;
        END IF;
    END LOOP;

    v_id     := 'pxc_' || replace(replace(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+', '-'), '/', '_');
    v_secret := 'pxcs_' || replace(replace(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_');

    INSERT INTO public.mcp_oauth_clients
        (client_id, client_name, redirect_uris, token_endpoint_auth_method,
         client_secret_hash, organization_id, registration_meta)
    VALUES
        (v_id, left(p_client_name, 200), p_redirect_uris, 'client_secret_post',
         encode(extensions.digest(v_secret, 'sha256'), 'hex'), p_organization_id,
         jsonb_build_object('source', 'admin'));

    RETURN QUERY SELECT v_id, v_secret;
END $$;

REVOKE ALL ON FUNCTION public.mcp_create_confidential_client(text, jsonb, uuid) FROM PUBLIC, anon;
