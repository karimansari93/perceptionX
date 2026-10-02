// Client share hosts: https://<client>.perceptionx.ai/<token> serves that
// client's Amplify page, and nothing else.
//
// The same Netlify site answers on every host, so without this a client
// subdomain would be a full copy of app.perceptionx.ai: the sign-in page at its
// root (indexable, by design, on the app host), the dashboard behind it, and
// another client's link opening under this client's name. On a share host:
//
// - /<token> is the Amplify page, only when that token was minted for the org
//   whose activate_branding.link_subdomain is this host's subdomain. Any other
//   token, unknown or switched off, gets the same bare 404 as a random path, so
//   the host can't be used to probe which tokens exist.
// - / and every other page route is a bare 404. Static files the page needs
//   (/assets, /logos, /activate-og cards, fonts, favicons) pass through.
// - Every response carries X-Robots-Tag: noindex. robots.txt allows crawling on
//   purpose and names no sitemap: a crawler has to be able to fetch a page to
//   read its noindex, and a Disallowed URL can still be listed from a link.
//
// On any other host (app.perceptionx.ai, deploy previews, localhost) this is a
// pass-through.

import {
  SHARE_ROBOTS,
  shareSubdomain,
  tokenFromSharePath,
} from "../lib/amplify-host.js";
import { activatePreview } from "../lib/activate-preview.js";
import { personalizeAmplifyHtml } from "./activate-meta.ts";

const ROBOTS_TXT = `# Private Amplify links. Nothing on this host is meant for a search index;
# every response says so with X-Robots-Tag: noindex.
User-agent: *
Allow: /
`;

/** Paths that are files the page loads, never pages. */
const STATIC_PREFIXES = ["/assets/", "/logos/", "/activate-og/", "/fonts/", "/favicon"];

function withRobots(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", SHARE_ROBOTS);
  return new Response(response.body, { status: response.status, headers });
}

function notFound(reason: string): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": SHARE_ROBOTS,
      "x-amplify-host": reason,
    },
  });
}

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const url = new URL(request.url);
  const sub = shareSubdomain(url.hostname);
  if (!sub) return context.next();

  if (url.pathname === "/robots.txt") {
    return new Response(ROBOTS_TXT, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": SHARE_ROBOTS,
      },
    });
  }

  // Files, not pages. HTML is excluded: home.html is the app host's indexable
  // sign-in page and has no business answering here.
  const isFile = /\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname);
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) || isFile) {
    return withRobots(await context.next());
  }

  const token = tokenFromSharePath(url.pathname);
  if (!token) return notFound("not-a-link");

  let branding: Awaited<ReturnType<typeof activatePreview>>["branding"] = null;
  try {
    ({ branding } = await activatePreview(token));
  } catch {
    branding = null;
  }
  // Fails closed: if the lookup can't run, the page isn't served here. The
  // app-host URL for the same token still works.
  if (!branding) return notFound("unknown-link");
  if (branding.link_subdomain !== sub) return notFound("wrong-host");

  // The SPA fallback serves index.html for /<token>; the app renders the
  // Amplify page for it on a share host (see src/App.tsx).
  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return withRobots(response);

  const linkUrl = `${url.origin}/${encodeURIComponent(token)}`;
  const html = personalizeAmplifyHtml(await response.text(), branding, {
    origin: url.origin,
    token,
    linkUrl,
  });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  headers.set("x-robots-tag", SHARE_ROBOTS);
  headers.set("x-amplify-host", "ok");
  return new Response(html, { status: response.status, headers });
};

// /assets/* is excluded so the app host doesn't pay an edge hop per hashed
// chunk; on a share host those are content-addressed bundles, not pages.
export const config = { path: "/*", excludedPath: ["/assets/*"] };
