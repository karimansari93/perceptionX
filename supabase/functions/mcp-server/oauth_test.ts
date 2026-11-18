// Confidential-client OAuth flow (Gemini Enterprise and other hosts that
// cannot self-register), against an in-memory stand-in for the Supabase
// client. Run: cd supabase/functions && deno test mcp-server/
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleAuthorize, handleAuthorizeApprove, handleAuthorizeInfo, handleToken,
  presentedClientCredentials,
} from "./oauth.ts";
import { sha256Base64Url, sha256Hex } from "./http.ts";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-0000000000u1";
const REDIRECT = "https://host.example/oauth-redirect";
const SECRET = "pxcs_test-secret";
const CFG = {
  issuer: "https://app.example",
  resource: "https://app.example/mcp",
  consentUrl: "https://app.example/connect/consent",
};

// ── minimal fake of the supabase-js query builder ──────────────────────────
function fakeAdmin(tables: Record<string, any[]>) {
  let seq = 0;
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: [string, string, any][] = [];
    let mode: "select" | "update" | "delete" = "select";
    let patch: any = null;
    const rows = () => tables[table].filter((r) => filters.every(([op, k, v]) =>
      op === "eq" ? r[k] === v : op === "in" ? v.includes(r[k]) : op === "lt" ? r[k] < v : true));
    const run = () => {
      if (mode === "update") rows().forEach((r) => Object.assign(r, patch));
      if (mode === "delete") { const kill = new Set(rows()); tables[table] = tables[table].filter((r) => !kill.has(r)); }
      return { data: rows(), error: null };
    };
    const b: any = {
      select: () => b,
      eq: (k: string, v: any) => (filters.push(["eq", k, v]), b),
      in: (k: string, v: any[]) => (filters.push(["in", k, v]), b),
      lt: (k: string, v: any) => (filters.push(["lt", k, v]), b),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (p: any) => ((mode = "update"), (patch = p), b),
      delete: () => ((mode = "delete"), b),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      insert: (input: any) => {
        const list = (Array.isArray(input) ? input : [input]).map((r) => ({
          id: `id-${++seq}`, expires_at: new Date(Date.now() + 600_000).toISOString(),
          consumed_at: null, used_at: null, revoked_at: null, ...r,
        }));
        tables[table].push(...list);
        const res = { data: list, error: null };
        return { select: () => ({ single: async () => ({ data: list[0], error: null }) }), then: (f: any) => Promise.resolve(res).then(f) };
      },
    };
    return b;
  };
  return {
    tables,
    from,
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async (jwt: string) => jwt === "user-jwt" ? { data: { user: { id: USER } }, error: null } : { data: { user: null }, error: "no" } },
  };
}

async function setup(opts: { secret?: boolean; boundOrg?: string | null } = {}) {
  return fakeAdmin({
    mcp_oauth_clients: [{
      client_id: "pxc_gemini", client_name: "Gemini Enterprise", redirect_uris: [REDIRECT],
      client_secret_hash: opts.secret === false ? null : await sha256Hex(SECRET),
      organization_id: opts.boundOrg === undefined ? ORG_A : opts.boundOrg,
    }],
    organization_members: [
      { id: "m1", user_id: USER, organization_id: ORG_A, organizations: { id: ORG_A, name: "Org A" } },
      { id: "m2", user_id: USER, organization_id: ORG_B, organizations: { id: ORG_B, name: "Org B" } },
    ],
    mcp_org_settings: [{ organization_id: ORG_A, enabled: true }, { organization_id: ORG_B, enabled: true }],
    user_roles: [],
  });
}

async function authorize(admin: any, extra = "") {
  const res = await handleAuthorize(new Request(
    `${CFG.resource}/authorize?client_id=pxc_gemini&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&state=s1${extra}`,
  ), admin, CFG);
  return res;
}

async function approve(admin: any, orgId: string) {
  const requestId = admin.tables.mcp_oauth_requests.at(-1).id;
  const res = await handleAuthorizeApprove(new Request(`${CFG.resource}/authorize/approve`, {
    method: "POST", headers: { authorization: "Bearer user-jwt", "content-type": "application/json" },
    body: JSON.stringify({ request_id: requestId, organization_id: orgId }),
  }), admin);
  return { res, body: await res.json() };
}

function tokenRequest(form: Record<string, string>, basic?: string) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (basic) headers.authorization = `Basic ${btoa(basic)}`;
  return new Request(`${CFG.resource}/token`, { method: "POST", headers, body: new URLSearchParams(form).toString() });
}

Deno.test("confidential client: no PKCE, secret in the body, full flow", async () => {
  const admin = await setup();
  const a = await authorize(admin);
  assertEquals(a.status, 302);
  assert(a.headers.get("location")!.startsWith(CFG.consentUrl));
  const { body } = await approve(admin, ORG_A);
  const code = new URL(body.redirect_to).searchParams.get("code")!;

  const t = await handleToken(tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: "pxc_gemini", client_secret: SECRET,
  }), admin);
  assertEquals(t.status, 200);
  const tok = await t.json();
  assert(tok.access_token && tok.refresh_token);
  assertEquals(admin.tables.mcp_tokens[0].organization_id, ORG_A);

  // Refresh needs the secret too (Basic auth this time).
  const noSecret = await handleToken(tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh_token }), admin);
  assertEquals(noSecret.status, 401);
  const r = await handleToken(tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refresh_token }, `pxc_gemini:${SECRET}`), admin);
  assertEquals(r.status, 200);
});

Deno.test("confidential client: wrong or missing secret is refused", async () => {
  for (const secret of ["wrong", ""]) {
    const admin = await setup();
    await authorize(admin);
    const { body } = await approve(admin, ORG_A);
    const code = new URL(body.redirect_to).searchParams.get("code")!;
    const form: Record<string, string> = { grant_type: "authorization_code", code, client_id: "pxc_gemini" };
    if (secret) form.client_secret = secret;
    const t = await handleToken(tokenRequest(form), admin);
    assertEquals(t.status, 401);
    assertEquals(admin.tables.mcp_tokens?.length ?? 0, 0);
  }
});

Deno.test("confidential client with PKCE: the verifier is still checked", async () => {
  const admin = await setup();
  const verifier = "v".repeat(50);
  await authorize(admin, `&code_challenge=${await sha256Base64Url(verifier)}&code_challenge_method=S256`);
  const { body } = await approve(admin, ORG_A);
  const code = new URL(body.redirect_to).searchParams.get("code")!;
  const bad = await handleToken(tokenRequest({ grant_type: "authorization_code", code, code_verifier: "x".repeat(50) }, `pxc_gemini:${SECRET}`), admin);
  assertEquals(bad.status, 400);
});

Deno.test("client bound to one organization: consent offers only it, approve refuses others", async () => {
  const admin = await setup();
  await authorize(admin);
  const requestId = admin.tables.mcp_oauth_requests.at(-1).id;
  const info = await (await handleAuthorizeInfo(new Request(`${CFG.resource}/authorize/info?request_id=${requestId}`, {
    headers: { authorization: "Bearer user-jwt" },
  }), admin)).json();
  assertEquals(info.organizations.map((o: any) => o.id), [ORG_A]);
  const { res } = await approve(admin, ORG_B);
  assertEquals(res.status, 403);
});

Deno.test("public client: PKCE stays mandatory and a secret is refused", async () => {
  const admin = await setup({ secret: false, boundOrg: null });
  const a = await authorize(admin);
  assertEquals(a.status, 302);
  assert(new URL(a.headers.get("location")!).searchParams.get("error") === "invalid_request");

  const verifier = "v".repeat(50);
  await authorize(admin, `&code_challenge=${await sha256Base64Url(verifier)}&code_challenge_method=S256`);
  const { body } = await approve(admin, ORG_B);
  const code = new URL(body.redirect_to).searchParams.get("code")!;
  const withSecret = await handleToken(tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pxc_gemini", client_secret: "made-up" }), admin);
  assertEquals(withSecret.status, 401);
  const ok = await handleToken(tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "pxc_gemini" }), admin);
  assertEquals(ok.status, 200);
});

Deno.test("Basic credentials are form-urlencoded per RFC 6749 §2.3.1", () => {
  const req = new Request("https://x/token", { headers: { authorization: `Basic ${btoa("pxc_a%3Ab:s%2Bc")}` } });
  assertEquals(presentedClientCredentials(req, {}), { clientId: "pxc_a:b", clientSecret: "s+c" });
});
