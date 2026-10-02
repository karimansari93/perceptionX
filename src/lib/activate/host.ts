// Client share hosts for Amplify links: https://<client>.perceptionx.ai/<token>.
// Mirrors netlify/lib/amplify-host.js, which does the server-side half (the
// host check, the per-client token check, noindex on everything).

export const SHARE_DOMAIN = 'perceptionx.ai';

const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'admin', 'mail', 'staging']);

/** `csl` for csl.perceptionx.ai; null for app.perceptionx.ai, previews, localhost. */
export function shareSubdomain(hostname: string): string | null {
  const host = hostname.toLowerCase();
  const suffix = `.${SHARE_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;
  const sub = host.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return null;
  return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
}

export const isShareHost = (): boolean =>
  typeof window !== 'undefined' && shareSubdomain(window.location.hostname) !== null;
