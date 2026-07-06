// Personalizes link-preview meta tags for onboarding invites.
//
// Runs on /onboarding/* before Netlify's redirect chain, which serves
// onboarding.html (index.html with generic project-setup meta, built in
// vite.config.ts). This function looks up the invite's company name via the
// read-only intake_preview_by_token RPC — NOT intake_get_by_token, which
// flips the invite to in_progress and would let social crawlers corrupt the
// admin status — and rewrites the title/description/og tags around it.
//
// Any failure (missing env, RPC error, unknown token, slow network) falls
// back to the generic onboarding.html untouched.

const RPC_TIMEOUT_MS = 3000;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const env = (key: string): string | undefined =>
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Netlify?.env?.get(key) ??
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.env?.get(key);

async function lookupCompanyName(token: string): Promise<string | null> {
  const supabaseUrl = env("VITE_SUPABASE_URL");
  const anonKey = env("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !anonKey) return null;

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/intake_preview_by_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const name = data?.company_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const response = await context.next();

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // /onboarding/<token> — anything else (e.g. bare /onboarding) stays generic.
  const token = new URL(request.url).pathname.split("/").filter(Boolean)[1];
  if (!token) return response;

  let companyName: string | null = null;
  try {
    companyName = await lookupCompanyName(token);
  } catch {
    return response;
  }
  if (!companyName) return response;

  const safe = escapeHtml(companyName);
  const title = `${safe}&#39;s Project Setup — PerceptionX`;
  const description = `You&#39;ve been invited to set up ${safe}&#39;s PerceptionX project. Complete your brief to see how AI describes your employer brand.`;

  const html = (await response.text())
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`);

  const headers = new Headers(response.headers);
  // Personalized per token — never let a shared cache serve one company's
  // preview for another's link.
  headers.set("cache-control", "private, max-age=0, must-revalidate");
  return new Response(html, { status: response.status, headers });
};

export const config = { path: "/onboarding/*" };
