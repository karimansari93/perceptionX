// Client share hosts for Amplify links: https://<client>.perceptionx.ai/<token>.
//
// A share host serves one thing, an Amplify page for a token minted for that
// client, and nothing else: no sign-in page at the root, no dashboard, nothing
// a search engine could index. Which client a host belongs to is
// activate_branding.link_subdomain; this module only decides whether a
// hostname is a share host at all. Keep in sync with src/lib/activate/host.ts.

export const SHARE_DOMAIN = 'perceptionx.ai';

/** Subdomains that belong to us, never to a client. */
export const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'admin', 'mail', 'staging']);

/** `csl` for csl.perceptionx.ai; null for app.perceptionx.ai, previews, localhost. */
export function shareSubdomain(hostname) {
  const host = String(hostname).toLowerCase();
  const suffix = `.${SHARE_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;
  const sub = host.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return null;
  return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
}

/** A share-host path that is a link token: one segment, token alphabet. */
export function tokenFromSharePath(pathname) {
  const m = /^\/([A-Za-z0-9_-]{20,64})\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * Sent on every response from a share host. Allowing crawl and saying noindex
 * is what actually keeps a page out of Google: a robots.txt Disallow stops the
 * crawler from ever reading this, and a blocked URL can still be listed from an
 * external link.
 */
export const SHARE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
