// ─── mcp-server: the PerceptionX MCP surface ────────────────────────────────
// Remote MCP server (Streamable HTTP, JSON responses) exposing the shared
// px-tools data layer to MCP hosts — ChatGPT custom connectors, Claude,
// Claude Code, MCP Inspector. One function serves both:
//   * OAuth 2.1 authorization server endpoints (see oauth.ts)
//   * the MCP JSON-RPC endpoint (initialize / tools/list / tools/call)
//
// Reachable two ways (the path prefix is normalized below):
//   * proxied (production): https://app.perceptionx.ai/mcp  (+ root
//     /.well-known/* via Netlify redirects) — the URL clients configure
//   * direct: https://<ref>.supabase.co/functions/v1/mcp-server (testing)
//
// Security model, in order:
//   1. Bearer token (OAuth access token or admin-minted PAT) → sha256 lookup
//      in mcp_tokens → yields the ORGANIZATION. Never model- or client-chosen.
//   2. mcp_org_settings allowlist: no row / disabled → no access.
//   3. Per-token per-minute + per-org daily rate limits (mcp_request_log).
//   4. Every tool call re-validates company ownership inside px-tools.
//   5. Read-only scope; no mutating tool exists in the registry.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeTool, genRequestId, mcpTools } from "../_shared/px-tools/mod.ts";
import type { ToolContext } from "../_shared/px-tools/mod.ts";
import { json, MCP_CORS_HEADERS, sha256Hex } from "./http.ts";
import {
  authorizationServerMetadata, handleAuthorize, handleAuthorizeApprove,
  handleAuthorizeInfo, handleRegister, handleRevoke, handleToken,
  protectedResourceMetadata,
} from "./oauth.ts";
import type { OAuthConfig } from "./oauth.ts";

const ISSUER = Deno.env.get('MCP_ISSUER') || 'https://app.perceptionx.ai';
const RESOURCE = Deno.env.get('MCP_RESOURCE') || `${ISSUER}/mcp`;
const CONSENT_URL = Deno.env.get('MCP_CONSENT_URL') || `${ISSUER}/connect/consent`;
const CFG: OAuthConfig = { issuer: ISSUER, resource: RESOURCE, consentUrl: CONSENT_URL };

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_VERSION = '1.0.0';

// The host model (ChatGPT/Claude) includes these instructions in its context.
// This is the only prompt-level surface we get over MCP — everything else
// must live in tool descriptions and result payloads.
const SERVER_INSTRUCTIONS = `PerceptionX tracks how consumer AI platforms (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode) describe this organization as an employer — visibility, sentiment, themes, cited sources, and competitors, by market.

Rules for using these tools:
1. Answer ONLY from tool results. Never fill gaps with general knowledge about the company — if a tool didn't return it, say the data isn't tracked yet.
2. Every result has a _coverage field (found / partial / no_data). Honor it: on no_data, say so plainly; on partial, name what's missing.
3. Periods are quarters ("Q3 2026"); the running quarter is marked "(in progress)" — a lighter latest point is normal, never call it a decline. Quote _meta.period_range and the matched market spellings when precision matters.
4. Sentiment and visibility are percentages ("81%") — present them that way, never as decimals.
5. Data is scoped to this user's organization only. There is no cross-customer data.
6. Competitor "share of voice on an attribute" means who gets NAMED when the topic comes up — it is not a claim that the competitor is rated better.
7. Start with list_companies if you don't know company IDs. For market questions ("culture in India") use get_attribute_themes / get_visibility / get_sources / get_competitor_landscape / get_trends.`;

// ─── Token auth ─────────────────────────────────────────────────────────────

interface Principal {
  tokenId: string;
  kind: string;
  organizationId: string;
  perMinute: number;
  dailyQuota: number;
}

function unauthorized(description: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', error_description: description }), {
    status: 401,
    headers: {
      ...MCP_CORS_HEADERS,
      'Content-Type': 'application/json',
      // RFC 9728: points the MCP client at the resource metadata, which names
      // the authorization server — this header is what kicks off the OAuth
      // flow in ChatGPT/Claude when a connector is first added.
      'WWW-Authenticate': `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
    },
  });
}

async function authenticateBearer(req: Request, admin: any): Promise<Principal | Response> {
  const auth = req.headers.get('authorization') || '';
  const raw = auth.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return unauthorized('Missing bearer token.');

  const hash = await sha256Hex(raw);
  const { data: token } = await admin
    .from('mcp_tokens')
    .select('id, kind, organization_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .in('kind', ['access', 'pat'])
    .maybeSingle();
  if (!token) return unauthorized('Unknown token.');
  if (token.revoked_at) return unauthorized('Token revoked.');
  if (token.expires_at && new Date(token.expires_at) < new Date()) return unauthorized('Token expired.');

  const { data: settings } = await admin
    .from('mcp_org_settings')
    .select('enabled, per_minute_limit, daily_quota')
    .eq('organization_id', token.organization_id)
    .maybeSingle();
  if (!settings?.enabled) return unauthorized('MCP access is not enabled for this organization.');

  // Fire-and-forget freshness marker.
  admin.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', token.id).then(() => {});

  return {
    tokenId: token.id,
    kind: token.kind,
    organizationId: token.organization_id,
    perMinute: settings.per_minute_limit ?? 60,
    dailyQuota: settings.daily_quota ?? 2000,
  };
}

async function checkRateLimit(admin: any, p: Principal): Promise<string | null> {
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const dayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
  const [minuteRes, dayRes] = await Promise.all([
    admin.from('mcp_request_log').select('id', { count: 'exact', head: true })
      .eq('token_id', p.tokenId).gte('ts', minuteAgo),
    admin.from('mcp_request_log').select('id', { count: 'exact', head: true })
      .eq('organization_id', p.organizationId).gte('ts', dayStart),
  ]);
  if ((minuteRes.count ?? 0) >= p.perMinute) {
    return `Rate limit reached (${p.perMinute} requests/minute). Wait a minute and try again.`;
  }
  if ((dayRes.count ?? 0) >= p.dailyQuota) {
    return `Daily quota reached (${p.dailyQuota} requests/day for this organization). Resets at midnight UTC.`;
  }
  return null;
}

function logRequest(admin: any, p: Principal | null, entry: Record<string, unknown>): void {
  admin.from('mcp_request_log').insert({
    organization_id: p?.organizationId ?? null,
    token_id: p?.tokenId ?? null,
    token_kind: p?.kind ?? null,
    ...entry,
  }).then(() => {}).catch(() => {});
}

// ─── JSON-RPC handling ──────────────────────────────────────────────────────

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleRpcMessage(
  msg: any,
  admin: any,
  p: Principal,
  requestId: string
): Promise<Record<string, unknown> | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return rpcError(msg?.id ?? null, -32600, 'Invalid JSON-RPC request.');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      logRequest(admin, p, { method, status: 'ok', client_info: JSON.stringify(params?.clientInfo ?? null).slice(0, 300) });
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'perceptionx', title: 'PerceptionX', version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      logRequest(admin, p, { method, status: 'ok' });
      return rpcResult(id, { tools: mcpTools });
    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments ?? {};
      if (typeof toolName !== 'string') return rpcError(id, -32602, 'params.name is required.');
      const t0 = Date.now();
      const ctx: ToolContext = { admin, organizationId: p.organizationId, requestId };
      const resultText = await executeTool(ctx, toolName, args);
      let parsed: any = null;
      try { parsed = JSON.parse(resultText); } catch { /* keep raw text */ }
      const isError = !!(parsed && typeof parsed === 'object' && parsed.error);
      logRequest(admin, p, {
        method, tool_name: toolName,
        args: JSON.parse(JSON.stringify(args ?? {})),
        status: isError ? 'tool_error' : 'ok',
        error: isError ? String(parsed.error).slice(0, 500) : null,
        duration_ms: Date.now() - t0,
      });
      return rpcResult(id, {
        content: [{ type: 'text', text: resultText }],
        ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { structuredContent: parsed } : {}),
        isError,
      });
    }
    default:
      if (isNotification) return null;           // notifications/*: acknowledge silently
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function handleMcpEndpoint(req: Request, admin: any): Promise<Response> {
  if (req.method === 'GET' || req.method === 'DELETE') {
    // No server-initiated stream and no session state — stateless JSON mode.
    return new Response(null, { status: 405, headers: MCP_CORS_HEADERS });
  }

  const principal = await authenticateBearer(req, admin);
  if (principal instanceof Response) return principal;

  const limitMsg = await checkRateLimit(admin, principal);
  const requestId = genRequestId();

  let body: any;
  try { body = await req.json(); } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }

  const protocolHeader = req.headers.get('mcp-protocol-version');
  const respHeaders: Record<string, string> = protocolHeader
    ? { 'MCP-Protocol-Version': protocolHeader } : {};

  const handleWithLimit = async (msg: any) => {
    if (limitMsg && msg?.method === 'tools/call') {
      logRequest(admin, principal, { method: 'tools/call', tool_name: msg?.params?.name ?? null, status: 'rate_limited' });
      return rpcResult(msg.id, {
        content: [{ type: 'text', text: JSON.stringify({ error: limitMsg }) }],
        isError: true,
      });
    }
    return handleRpcMessage(msg, admin, principal, requestId);
  };

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(handleWithLimit))).filter(r => r !== null);
    if (!responses.length) return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
    return json(responses, 200, respHeaders);
  }

  const response = await handleWithLimit(body);
  if (response === null) return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
  return json(response, 200, respHeaders);
}

// ─── Router ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: MCP_CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceKey);

  // Normalize away the function-name prefix so proxied (/mcp/*) and direct
  // (/functions/v1/mcp-server/*) requests route identically.
  let path = new URL(req.url).pathname;
  path = path.replace(/^\/mcp-server/, '').replace(/^\/mcp(?=\/|$)/, '');
  if (path === '') path = '/';

  try {
    if (path === '/.well-known/oauth-authorization-server') return authorizationServerMetadata(CFG);
    if (path === '/.well-known/oauth-protected-resource') return protectedResourceMetadata(CFG);
    if (path === '/register' && req.method === 'POST') return await handleRegister(req, admin);
    if (path === '/authorize' && req.method === 'GET') return await handleAuthorize(req, admin, CFG);
    if (path === '/authorize/info' && req.method === 'GET') return await handleAuthorizeInfo(req, admin);
    if (path === '/authorize/approve' && req.method === 'POST') return await handleAuthorizeApprove(req, admin);
    if (path === '/token' && req.method === 'POST') return await handleToken(req, admin);
    if (path === '/revoke' && req.method === 'POST') return await handleRevoke(req, admin);
    if (path === '/') return await handleMcpEndpoint(req, admin);
    return json({ error: 'not_found' }, 404);
  } catch (err: any) {
    console.error('mcp-server fatal:', err);
    return json({ error: 'server_error', message: err?.message ?? 'Unexpected error' }, 500);
  }
});
