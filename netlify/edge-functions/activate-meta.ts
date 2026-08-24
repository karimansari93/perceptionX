// Personalizes the link preview for an Activate link: /activate/<token>
//
// Runs before Netlify's redirect chain, which serves activate.html (index.html
// with generic Activate meta, built in vite.config.ts). Without this the SPA
// fallback handed crawlers the dashboard's own tags — "PerceptionX Dashboard —
// Enterprise AI Employer Reputation Management. Sign in to see..." over a
// screenshot of our product — because the client-branded useMetaTags call in
// src/pages/Activate.tsx is JavaScript, and no unfurler runs JavaScript.
//
// Branding comes from activate_preview_by_token, never activate_get_by_token:
// the latter stamps an 'open' event, and a WhatsApp unfurl is not somebody
// opening a link. Any failure — missing env, RPC error, unknown or switched-off
// token, slow network — leaves the generic activate.html untouched, which is
// already a sane preview rather than the wrong one.

import { previewCopy } from "../lib/activate-card.js";
import { activatePreview, escapeHtml, tokenFromPath } from "../lib/activate-preview.js";

const set = (html: string, pattern: RegExp, value: string) =>
  html.replace(pattern, `$1${value}$2`);

/**
 * Tag the generic response with why it stayed generic. A degraded preview is
 * indistinguishable from a correct one from outside — this is what makes
 * `curl -I` able to tell an unknown token from a deploy with no credentials.
 */
function withReason(response: Response, reason: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-activate-preview", reason);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Same cache policy as the other HTML entry points: the token is in the URL, so
 * a shared cache can't cross links, but the document still points at hashed
 * chunks and must never go stale.
 */
function htmlResponse(response: Response, html: string): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(html, { status: response.status, headers });
}

/**
 * og:url and canonical for the link actually being fetched.
 *
 * These are injected rather than rewritten, and unconditionally rather than
 * only on a successful lookup, because getting them wrong is worse than any
 * other tag on the page: WhatsApp, Facebook and LinkedIn navigate to og:url
 * when someone taps the preview card. Inheriting index.html's value sent
 * recipients to https://app.perceptionx.ai — the sign-in route, which forwards
 * anyone holding a session to the dashboard instead of to the link a colleague
 * sent them. The request URL is known whether or not branding resolves, so this
 * runs before the branding check and activate.html ships neither tag.
 */
function withLinkUrl(html: string, linkUrl: string): string {
  return html.replace(
    "</head>",
    `  <meta property="og:url" content="${linkUrl}" />\n` +
      `    <link rel="canonical" href="${linkUrl}" />\n  </head>`,
  );
}

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const response = await context.next();

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // /activate/<token> — anything else (e.g. a bare /activate) stays generic.
  const token = tokenFromPath(request.url);
  if (!token) return response;

  const origin = new URL(request.url).origin;
  const linkUrl = `${origin}/activate/${encodeURIComponent(token)}`;

  let branding: Awaited<ReturnType<typeof activatePreview>>["branding"] = null;
  let reason = "error";
  try {
    ({ branding, reason } = await activatePreview(token));
  } catch {
    reason = "error";
  }

  // No branding still gets the right URL — the generic preview is a fallback,
  // not a reason to point the card at the wrong page.
  if (!branding) {
    return withReason(
      htmlResponse(response, withLinkUrl(await response.text(), linkUrl)),
      reason,
    );
  }

  const name = escapeHtml(branding.display_name);
  const { title, description } = previewCopy(name);
  // Rendered per token by activate-og.ts, on this deploy's own origin so branch
  // deploys preview themselves rather than production.
  const card = `${origin}/activate-og/${encodeURIComponent(token)}.png`;

  let html = (await response.text())
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = set(html, /(<meta name="description" content=")[^"]*(")/, description);
  html = set(html, /(<meta property="og:title" content=")[^"]*(")/, title);
  html = set(html, /(<meta property="og:description" content=")[^"]*(")/, description);
  html = set(html, /(<meta name="twitter:title" content=")[^"]*(")/, title);
  html = set(html, /(<meta name="twitter:description" content=")[^"]*(")/, description);
  html = set(html, /(<meta property="og:image" content=")[^"]*(")/, card);
  html = set(html, /(<meta name="twitter:image" content=")[^"]*(")/, card);
  html = set(
    html,
    /(<meta property="og:image:alt" content=")[^"]*(")/,
    `${name} — PerceptionX Activate`,
  );
  html = withLinkUrl(html, linkUrl);
  // og:site_name is the client's, not ours: an employee is being sent this by
  // their own employer, and the attribution line under the card should say so.
  html = set(html, /(<meta property="og:site_name" content=")[^"]*(")/, name);

  return withReason(htmlResponse(response, html), "ok");
};

export const config = { path: "/activate/*" };
