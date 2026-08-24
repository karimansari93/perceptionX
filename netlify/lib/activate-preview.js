// Token -> branding lookup shared by the two Activate edge functions
// (activate-meta.ts rewrites the page's meta tags, activate-og.ts draws the
// card the meta tags point at). Both run for crawlers, so both go through
// activate_preview_by_token rather than activate_get_by_token: the latter
// stamps an 'open' event, and a WhatsApp unfurl is not somebody opening a
// link — letting crawlers write to activate_link_events would put phantom
// opens at the top of every funnel in the admin.

const RPC_TIMEOUT_MS = 2500;
const LOGO_TIMEOUT_MS = 2500;

/** Publishable logo.dev key, same one the page uses; pk_ keys are client-side. */
const DEFAULT_LOGO_DEV_TOKEN = 'pk_ekarmbf-SbmRJ537a9wdxA';

export function env(key) {
  return (
    globalThis.Netlify?.env?.get(key) ??
    globalThis.Deno?.env?.get(key) ??
    globalThis.process?.env?.[key]
  );
}

/**
 * The anon key, under either name it goes by here.
 *
 * env.example and src/integrations/supabase/client.ts call it
 * VITE_SUPABASE_ANON_KEY; netlify/edge-functions/onboarding-meta.ts reads
 * VITE_SUPABASE_PUBLISHABLE_KEY. Only one of those can be the name actually set
 * on the deploy, and an edge function that guesses wrong doesn't error — it
 * just quietly serves the generic preview forever. Accept both rather than bet.
 */
function anonKey() {
  return env('VITE_SUPABASE_ANON_KEY') ?? env('VITE_SUPABASE_PUBLISHABLE_KEY');
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Branding for a live link, or null. Null covers every dead end there is —
 * unknown token, link switched off, Supabase unreachable, no env — and every
 * caller treats it the same way: fall back to the unbranded preview. A revoked
 * link deliberately gets no branding: the page behind it is a dead end, and its
 * preview should not still be advertising the client.
 */
export async function activatePreview(token) {
  const supabaseUrl = env('VITE_SUPABASE_URL');
  const key = anonKey();
  if (!supabaseUrl || !key || !token) return null;

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/activate_preview_by_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    const displayName =
      typeof data.display_name === 'string' && data.display_name.trim()
        ? data.display_name.trim()
        : null;
    if (!displayName) return null;
    return {
      display_name: displayName,
      tagline: typeof data.tagline === 'string' ? data.tagline : null,
      logo_url: data.logo_url ?? null,
      logo_domain: data.logo_domain ?? null,
      primary_color: data.primary_color || '#13274F',
      accent_color: data.accent_color || '#F59E0B',
    };
  } catch {
    return null;
  }
}

/** The token from /activate/<token> or /activate-og/<token>.png. */
export function tokenFromPath(url) {
  const { pathname } = new URL(url);
  const token = pathname.split('/').filter(Boolean)[1] ?? '';
  // Only the og route carries an extension, so only there is it safe to strip
  // one — a token is otherwise opaque and gets passed through as minted.
  return pathname.startsWith('/activate-og/') ? token.replace(/\.png$/i, '') : token;
}

export function logoDevUrl(domain, size = 256) {
  const key = env('VITE_LOGO_DEV_TOKEN') ?? DEFAULT_LOGO_DEV_TOKEN;
  return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${key}&size=${size}&format=png`;
}

/**
 * The client's mark as a data URI, or null.
 *
 * logo.dev by domain wins over the org's own upload for the same reason the tab
 * icon prefers it: logo.dev returns something square and raster, where a
 * client's upload is usually a wide SVG wordmark that neither centres in a disc
 * nor rasterises reliably. Inlining it keeps satori off the network entirely,
 * so a slow logo host costs one bounded fetch here instead of stalling a render.
 */
export async function logoDataUri(branding) {
  const candidates = [];
  if (branding?.logo_domain) candidates.push(logoDevUrl(branding.logo_domain));
  // Raster uploads only: satori cannot rasterise a remote SVG.
  if (branding?.logo_url && /\.(png|jpe?g)(\?|$)/i.test(branding.logo_url)) {
    candidates.push(branding.logo_url);
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') ?? '';
      if (!/^image\/(png|jpeg)/i.test(type)) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) continue;
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
