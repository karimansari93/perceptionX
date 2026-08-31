// ─── mcp-server: OAuth 2.1 authorization server ─────────────────────────────
// Implements the slice of OAuth 2.1 that MCP hosts (ChatGPT, Claude) speak:
//   * RFC 8414 authorization-server metadata
//   * RFC 9728 protected-resource metadata
//   * RFC 7591 dynamic client registration
//   * authorization-code + PKCE (S256, mandatory), refresh rotation
//   * RFC 7009 revocation
// The /authorize step never renders a login UI of its own: it parks the
// request in mcp_oauth_requests and bounces to the app's consent page, where
// the user is already authenticated with Supabase. The consent page calls
// /authorize/info + /authorize/approve with the user's Supabase JWT; approve
// mints the single-use code and hands back the redirect.
//
// Tokens are opaque random strings, stored sha256-hashed, org-scoped. No JWTs
// are issued: revocation must be instant and the only consumer is this
// server.

import {
  isAcceptableRedirectUri, json, oauthError, parseBody,
  randomToken, sha256Base64Url, sha256Hex,
} from './http.ts';

export interface OAuthConfig {
  issuer: string;        // e.g. https://app.perceptionx.ai
  resource: string;      // e.g. https://app.perceptionx.ai/mcp (the MCP endpoint)
  consentUrl: string;    // e.g. https://app.perceptionx.ai/connect/consent
}

const SCOPE = 'perceptionx:read';
const ACCESS_TOKEN_TTL_S = 3600;                 // 1 hour
const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600;      // 30 days

export function authorizationServerMetadata(cfg: OAuthConfig): Response {
  return json({
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.resource}/authorize`,
    token_endpoint: `${cfg.resource}/token`,
    registration_endpoint: `${cfg.resource}/register`,
    revocation_endpoint: `${cfg.resource}/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    // Clients may present an https client-metadata URL as their client_id
    // (CIMD) instead of registering — Claude's "hosted client metadata".
    client_id_metadata_document_supported: true,
  });
}

export function protectedResourceMetadata(cfg: OAuthConfig): Response {
  return json({
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'PerceptionX',
  });
}

// ── RFC 7591 dynamic client registration ────────────────────────────────────
export async function handleRegister(req: Request, admin: any): Promise<Response> {
  const body = await parseBody(req);
  const redirectUris: unknown = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
      !redirectUris.every(u => typeof u === 'string' && isAcceptableRedirectUri(u))) {
    return oauthError('invalid_redirect_uri',
      'redirect_uris must be a non-empty array of https URLs (http allowed for localhost only).');
  }
  const clientId = randomToken('pxc_', 16);
  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null;
  const { error } = await admin.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    registration_meta: {
      client_uri: typeof body.client_uri === 'string' ? body.client_uri.slice(0, 500) : null,
      software_id: typeof body.software_id === 'string' ? body.software_id.slice(0, 200) : null,
    },
  });
  if (error) return oauthError('server_error', 'Registration failed.', 500);
  return json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, 201);
}

// ── Client resolution: registered row, or CIMD ──────────────────────────────
// CIMD (client-ID metadata documents): the client_id IS an https URL to a
// metadata JSON the client's vendor hosts (Anthropic does this for Claude —
// their "hosted client metadata" option). We fetch it once, validate the
// redirect_uris, and cache it as a client row keyed by the URL. Avoids one
// DCR registration per user on busy hosts.
function isBlockedCimdHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1';
}

async function resolveClient(
  admin: any,
  clientId: string
): Promise<{ client_id: string; client_name: string | null; redirect_uris: string[] } | null> {
  const { data: row } = await admin
    .from('mcp_oauth_clients').select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId).maybeSingle();
  if (row) {
    return {
      client_id: row.client_id,
      client_name: row.client_name,
      redirect_uris: Array.isArray(row.redirect_uris) ? row.redirect_uris : [],
    };
  }

  // CIMD path: client_id must be a plausible public https URL.
  let url: URL;
  try { url = new URL(clientId); } catch { return null; }
  if (url.protocol !== 'https:' || isBlockedCimdHost(url.hostname)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(clientId, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
      redirect: 'error',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, 64_000);
    const meta = JSON.parse(text);
    const uris: unknown = meta?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 ||
        !uris.every((u: unknown) => typeof u === 'string' && isAcceptableRedirectUri(u))) {
      return null;
    }
    const clientName = typeof meta?.client_name === 'string' ? meta.client_name.slice(0, 200) : null;
    await admin.from('mcp_oauth_clients').upsert({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      registration_meta: { source: 'cimd' },
    }, { onConflict: 'client_id' });
    return { client_id: clientId, client_name: clientName, redirect_uris: uris as string[] };
  } catch {
    return null;
  }
}

// RFC 8252 §7.3: native apps use loopback redirects with EPHEMERAL ports, so
// registered loopback URIs (http://127.0.0.1/…, http://localhost/…) match a
// presented URI on scheme + hostname + path with ANY port. Everything else
// stays exact-match.
function isLoopbackHost(h: string): boolean {
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
}

export function redirectUriMatches(registered: string[], presented: string): boolean {
  if (registered.includes(presented)) return true;
  try {
    const p = new URL(presented);
    if (p.protocol !== 'http:' || !isLoopbackHost(p.hostname)) return false;
    return registered.some((r) => {
      try {
        const u = new URL(r);
        return u.protocol === 'http:' && u.hostname === p.hostname && u.pathname === p.pathname;
      } catch { return false; }
    });
  } catch { return false; }
}

// ── GET /authorize → park request, bounce to the app consent page ───────────
export async function handleAuthorize(req: Request, admin: any, cfg: OAuthConfig): Promise<Response> {
  const url = new URL(req.url);
  const q = (name: string) => url.searchParams.get(name) || '';

  const clientId = q('client_id');
  const redirectUri = q('redirect_uri');
  const responseType = q('response_type');
  const state = q('state');
  const scope = q('scope') || SCOPE;
  const codeChallenge = q('code_challenge');
  const codeChallengeMethod = q('code_challenge_method');
  const resource = q('resource');

  // Client + redirect_uri must validate BEFORE any redirect is issued —
  // never bounce a user agent to an unverified URI.
  const client = await resolveClient(admin, clientId);
  if (!client) return oauthError('invalid_client', 'Unknown client_id. Register via /register, or supply an https client-metadata URL (CIMD).');
  const registered: string[] = client.redirect_uris;
  if (!redirectUri || !redirectUriMatches(registered, redirectUri)) {
    return oauthError('invalid_request', 'redirect_uri does not match a registered URI.');
  }

  const redirectWithError = (error: string, description: string) => {
    const to = new URL(redirectUri);
    to.searchParams.set('error', error);
    to.searchParams.set('error_description', description);
    if (state) to.searchParams.set('state', state);
    return Response.redirect(to.toString(), 302);
  };

  if (responseType !== 'code') return redirectWithError('unsupported_response_type', 'Only response_type=code is supported.');
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return redirectWithError('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }

  const { data: request, error } = await admin.from('mcp_oauth_requests').insert({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: state || null,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: resource || null,
  }).select('id').single();
  if (error || !request) return redirectWithError('server_error', 'Could not start the authorization request.');

  const consent = new URL(cfg.consentUrl);
  consent.searchParams.set('request_id', request.id);
  return Response.redirect(consent.toString(), 302);
}

// ── Consent-page API: who is asking + which orgs can the user connect ───────
async function requireSupabaseUser(req: Request, admin: any): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Not authenticated' }, 401);
  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) return json({ error: 'Not authenticated' }, 401);
  return { userId: user.id };
}

// Platform admins (user_roles.role = 'admin') may connect ANY MCP-enabled
// org — the support/testing path, so PerceptionX staff can demo a client's
// connector without being added to the client's member list.
async function isPlatformAdmin(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin
    .from('user_roles').select('user_id')
    .eq('user_id', userId).eq('role', 'admin').maybeSingle();
  return !!data;
}

export async function handleAuthorizeInfo(req: Request, admin: any): Promise<Response> {
  const who = await requireSupabaseUser(req, admin);
  if (who instanceof Response) return who;
  const requestId = new URL(req.url).searchParams.get('request_id') || '';

  const { data: request } = await admin
    .from('mcp_oauth_requests')
    .select('id, client_id, scope, expires_at, consumed_at')
    .eq('id', requestId).maybeSingle();
  if (!request || request.consumed_at || new Date(request.expires_at) < new Date()) {
    return json({ error: 'This authorization request has expired. Start again from your AI assistant.' }, 410);
  }

  const { data: client } = await admin
    .from('mcp_oauth_clients').select('client_name')
    .eq('client_id', request.client_id).maybeSingle();

  let organizations: { id: string; name: string }[];
  if (await isPlatformAdmin(admin, who.userId)) {
    // Admins see every enabled org.
    const { data: enabledOrgs } = await admin
      .from('mcp_org_settings')
      .select('organization_id, organizations!inner(id, name)')
      .eq('enabled', true);
    organizations = (enabledOrgs || [])
      .map((s: any) => ({ id: s.organization_id, name: s.organizations?.name || 'Organization' }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  } else {
    // Orgs the user belongs to AND that have MCP enabled (explicit allowlist).
    const { data: memberships } = await admin
      .from('organization_members')
      .select('organization_id, organizations!inner(id, name)')
      .eq('user_id', who.userId);
    const orgIds = (memberships || []).map((m: any) => m.organization_id);
    let enabled = new Set<string>();
    if (orgIds.length) {
      const { data: settings } = await admin
        .from('mcp_org_settings').select('organization_id')
        .in('organization_id', orgIds).eq('enabled', true);
      enabled = new Set((settings || []).map((s: any) => s.organization_id));
    }
    organizations = (memberships || [])
      .filter((m: any) => enabled.has(m.organization_id))
      .map((m: any) => ({ id: m.organization_id, name: m.organizations?.name || 'Organization' }));
  }

  return json({
    client_name: client?.client_name || 'An MCP client',
    scope: request.scope,
    scope_description: 'Read-only access to your organization’s PerceptionX data (visibility, sentiment, themes, sources, competitors). No write access.',
    organizations,
    ...(organizations.length === 0
      ? { no_org_reason: 'MCP access is not enabled for your organization yet. Contact PerceptionX to enable it.' }
      : {}),
  });
}

export async function handleAuthorizeApprove(req: Request, admin: any): Promise<Response> {
  const who = await requireSupabaseUser(req, admin);
  if (who instanceof Response) return who;
  const body = await parseBody(req);
  const requestId = String(body.request_id || '');
  const organizationId = String(body.organization_id || '');
  if (!requestId || !organizationId) return json({ error: 'request_id and organization_id are required' }, 400);

  const { data: request } = await admin
    .from('mcp_oauth_requests')
    .select('id, client_id, redirect_uri, scope, state, code_challenge, resource, expires_at, consumed_at')
    .eq('id', requestId).maybeSingle();
  if (!request || request.consumed_at || new Date(request.expires_at) < new Date()) {
    return json({ error: 'This authorization request has expired. Start again from your AI assistant.' }, 410);
  }

  // Membership + org enablement re-checked server-side — the consent page's
  // org list is a convenience, never the boundary. Platform admins bypass
  // the membership arm only (enablement always applies).
  const [{ data: membership }, { data: settings }, isAdmin] = await Promise.all([
    admin.from('organization_members').select('id')
      .eq('organization_id', organizationId).eq('user_id', who.userId).maybeSingle(),
    admin.from('mcp_org_settings').select('enabled')
      .eq('organization_id', organizationId).maybeSingle(),
    isPlatformAdmin(admin, who.userId),
  ]);
  if (!membership && !isAdmin) return json({ error: 'You are not a member of this organization.' }, 403);
  if (!settings?.enabled) return json({ error: 'MCP access is not enabled for this organization.' }, 403);

  const rawCode = randomToken('pxac_', 32);
  const codeHash = await sha256Hex(rawCode);
  const { error: codeErr } = await admin.from('mcp_auth_codes').insert({
    code_hash: codeHash,
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    organization_id: organizationId,
    user_id: who.userId,
    scope: request.scope,
    code_challenge: request.code_challenge,
    resource: request.resource,
  });
  if (codeErr) return json({ error: 'Could not issue the authorization code.' }, 500);

  await admin.from('mcp_oauth_requests').update({ consumed_at: new Date().toISOString() }).eq('id', requestId);

  const to = new URL(request.redirect_uri);
  to.searchParams.set('code', rawCode);
  if (request.state) to.searchParams.set('state', request.state);
  return json({ redirect_to: to.toString() });
}

// ── POST /token: code exchange + refresh rotation ───────────────────────────
export async function handleToken(req: Request, admin: any): Promise<Response> {
  const body = await parseBody(req);
  const grantType = String(body.grant_type || '');

  // Opportunistic cleanup of expired short-lived rows (bounded, cheap).
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  admin.from('mcp_auth_codes').delete().lt('expires_at', dayAgo).then(() => {});
  admin.from('mcp_oauth_requests').delete().lt('expires_at', dayAgo).then(() => {});

  if (grantType === 'authorization_code') {
    const code = String(body.code || '');
    const codeVerifier = String(body.code_verifier || '');
    const clientId = String(body.client_id || '');
    const redirectUri = String(body.redirect_uri || '');
    if (!code || !codeVerifier) return oauthError('invalid_request', 'code and code_verifier are required.');

    const codeHash = await sha256Hex(code);
    const { data: stored } = await admin
      .from('mcp_auth_codes')
      .select('code_hash, client_id, redirect_uri, organization_id, user_id, scope, code_challenge, expires_at, used_at')
      .eq('code_hash', codeHash).maybeSingle();
    if (!stored) return oauthError('invalid_grant', 'Unknown or expired authorization code.');
    if (stored.used_at) {
      // Replayed code: revoke anything it minted (defense against code theft).
      return oauthError('invalid_grant', 'Authorization code already used.');
    }
    if (new Date(stored.expires_at) < new Date()) return oauthError('invalid_grant', 'Authorization code expired.');
    if (clientId && stored.client_id !== clientId) return oauthError('invalid_grant', 'client_id mismatch.');
    if (redirectUri && stored.redirect_uri !== redirectUri) return oauthError('invalid_grant', 'redirect_uri mismatch.');

    const challenge = await sha256Base64Url(codeVerifier);
    if (challenge !== stored.code_challenge) return oauthError('invalid_grant', 'PKCE verification failed.');

    await admin.from('mcp_auth_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', codeHash);
    return await issueTokenPair(admin, stored.organization_id, stored.user_id, stored.client_id, stored.scope, null);
  }

  if (grantType === 'refresh_token') {
    const refreshRaw = String(body.refresh_token || '');
    if (!refreshRaw) return oauthError('invalid_request', 'refresh_token is required.');
    const hash = await sha256Hex(refreshRaw);
    const { data: stored } = await admin
      .from('mcp_tokens')
      .select('id, kind, organization_id, user_id, client_id, scope, expires_at, revoked_at')
      .eq('token_hash', hash).eq('kind', 'refresh').maybeSingle();
    if (!stored) return oauthError('invalid_grant', 'Unknown refresh token.');
    if (stored.revoked_at) {
      // Rotation replay: a revoked refresh token was reused — burn the family.
      await admin.rpc('mcp_revoke_token', { p_token_id: stored.id });
      return oauthError('invalid_grant', 'Refresh token has been rotated. Re-authorize.');
    }
    if (stored.expires_at && new Date(stored.expires_at) < new Date()) {
      return oauthError('invalid_grant', 'Refresh token expired. Re-authorize.');
    }
    await admin.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', stored.id);
    return await issueTokenPair(admin, stored.organization_id, stored.user_id, stored.client_id, stored.scope, stored.id);
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

async function issueTokenPair(
  admin: any,
  organizationId: string,
  userId: string | null,
  clientId: string | null,
  scope: string,
  parentId: string | null
): Promise<Response> {
  const accessRaw = randomToken('pxat_', 32);
  const refreshRaw = randomToken('pxrt_', 32);
  const now = Date.now();
  const { error } = await admin.from('mcp_tokens').insert([
    {
      token_hash: await sha256Hex(accessRaw), kind: 'access',
      organization_id: organizationId, user_id: userId, client_id: clientId, scope,
      parent_id: parentId, expires_at: new Date(now + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
    },
    {
      token_hash: await sha256Hex(refreshRaw), kind: 'refresh',
      organization_id: organizationId, user_id: userId, client_id: clientId, scope,
      parent_id: parentId, expires_at: new Date(now + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
    },
  ]);
  if (error) return oauthError('server_error', 'Could not issue tokens.', 500);
  return json({
    access_token: accessRaw,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshRaw,
    scope,
  });
}

// ── POST /revoke (RFC 7009: always 200) ─────────────────────────────────────
export async function handleRevoke(req: Request, admin: any): Promise<Response> {
  const body = await parseBody(req);
  const raw = String(body.token || '');
  if (raw) {
    const hash = await sha256Hex(raw);
    const { data: stored } = await admin
      .from('mcp_tokens').select('id').eq('token_hash', hash).maybeSingle();
    if (stored) await admin.rpc('mcp_revoke_token', { p_token_id: stored.id });
  }
  return json({});
}
