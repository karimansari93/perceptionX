// Token -> branding lookup shared by the two Activate edge functions
// (activate-meta.ts rewrites the page's meta tags, activate-og.ts draws the
// card the meta tags point at). Both run for crawlers, so both go through
// activate_preview_by_token rather than activate_get_by_token: the latter
// stamps an 'open' event, and a WhatsApp unfurl is not somebody opening a
// link — letting crawlers write to activate_link_events would put phantom
// opens at the top of every funnel in the admin.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase-public.js';

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
 * `{ branding, reason }`. Branding is null for every dead end there is —
 * unknown token, link switched off, Supabase unreachable, no env — and every
 * caller falls back to the unbranded preview the same way. A revoked link
 * deliberately gets no branding: the page behind it is a dead end, and its
 * preview should not still be advertising the client.
 *
 * `reason` exists because those dead ends are indistinguishable from outside:
 * a preview that quietly degrades looks identical whether the token is wrong or
 * the deploy has no credentials. Both edge functions echo it as the
 * x-activate-preview header, so `curl -I` says which one it is. It names the
 * failure, never a value — 'no-env' says a variable is missing, not what it is.
 */
export async function activatePreview(token) {
  // The committed publishable credentials are the floor; env vars win when the
  // runtime can actually see them. 'no-env' is kept as a guard but should now
  // be unreachable.
  const supabaseUrl = env('VITE_SUPABASE_URL') ?? SUPABASE_URL;
  const key = anonKey() ?? SUPABASE_ANON_KEY;
  if (!token) return { branding: null, reason: 'no-token' };
  // The trap this caught in production: .env is a committed file, which Vite
  // reads at build time, so the app works while the edge runtime — which only
  // sees real environment variables — has nothing to authenticate with.
  if (!supabaseUrl || !key) return { branding: null, reason: 'no-env' };

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
    if (!res.ok) return { branding: null, reason: `http-${res.status}` };
    const data = await res.json();
    if (!data || data.error) return { branding: null, reason: 'not-found' };
    const displayName =
      typeof data.display_name === 'string' && data.display_name.trim()
        ? data.display_name.trim()
        : null;
    if (!displayName) return { branding: null, reason: 'not-found' };
    return {
      reason: 'ok',
      branding: {
      display_name: displayName,
      tagline: typeof data.tagline === 'string' ? data.tagline : null,
      logo_url: data.logo_url ?? null,
      logo_domain: data.logo_domain ?? null,
      primary_color: data.primary_color || '#13274F',
      accent_color: data.accent_color || '#F59E0B',
      },
    };
  } catch {
    return { branding: null, reason: 'fetch-failed' };
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

/** An oversized upload would balloon the data URI and stall the render. */
const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Natural aspect ratio (w/h) of a mark, so the card can size its plate to fit.
 * 1 is the safe default — a square plate crops nothing, it just leaves air.
 */
function imageAspect(bytes, type) {
  try {
    if (type === 'image/svg+xml') {
      const head = new TextDecoder().decode(bytes.subarray(0, 4096));
      const attr = (name) => {
        const m = new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)`, 'i').exec(head);
        return m ? Number(m[1]) : NaN;
      };
      const w = attr('width');
      const h = attr('height');
      if (w > 0 && h > 0) return w / h;
      // Percentage or unit-suffixed width/height fall through to the viewBox,
      // which is the only dimension an SVG is guaranteed to carry.
      const box = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
      if (box && Number(box[2]) > 0) return Number(box[1]) / Number(box[2]);
      return 1;
    }
    // PNG: IHDR width/height are the two big-endian u32s at byte 16.
    if (type === 'image/png' && bytes.length > 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const w = view.getUint32(16);
      const h = view.getUint32(20);
      if (w > 0 && h > 0) return w / h;
    }
  } catch {
    // fall through
  }
  return 1;
}

function toDataUri(bytes, type) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${type};base64,${btoa(bin)}`;
}

/**
 * The client's mark for the share card: `{ uri, aspect }`, or null.
 *
 * The logo an admin uploaded wins. It is the asset the client actually handed
 * over — Netflix's is the real gradient symbol where logo.dev returns a flat
 * icon on a black square, and Ford's is the oval wordmark rather than a crop of
 * it — so logo.dev is the fallback for orgs that haven't uploaded one, not the
 * default. (The tab favicon in src/pages/Activate.tsx still prefers logo.dev,
 * and should: a wide wordmark at 16px is mush, where a card has room for it.)
 *
 * SVG is inlined as a data URI and nested inside the card satori emits; resvg
 * rasterises it in place. It neither runs scripts nor fetches anything, so an
 * upload can only draw itself.
 *
 * Inlining also keeps satori off the network: a slow or dead logo host costs
 * one bounded fetch here rather than stalling a render at crawl time.
 */
export async function logoAsset(branding) {
  const candidates = [];
  if (branding?.logo_url) candidates.push(branding.logo_url);
  if (branding?.logo_domain) candidates.push(logoDevUrl(branding.logo_domain));

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
      if (!res.ok) continue;
      const type = (res.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(type)) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) continue;
      return { uri: toDataUri(bytes, type), aspect: imageAspect(bytes, type) };
    } catch {
      // try the next candidate
    }
  }
  return null;
}
