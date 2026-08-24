// Draws the share card for an Activate link: /activate-og/<token>.png
//
// activate-meta.ts points og:image here, so this is what actually renders in
// the WhatsApp thread the link gets forwarded into. The card is the client's —
// their canvas colour, their accent, their mark — because the page behind it is
// theirs too, and a recipient should recognise their own employer before they
// recognise us.
//
// Branding comes from activate_preview_by_token, which writes nothing: a social
// unfurl is not somebody opening the link, and must never land in the funnel.
//
// Failure is a design case, not an exception. An unknown or switched-off token
// still renders — just unbranded — and if the renderer itself can't run (the
// wasm fetch fails, a crawler is impatient) the request falls through to the
// card baked into public/logos/activate-og.png. A blank preview is the one
// outcome worth engineering against.

import satori from "https://esm.sh/satori@0.10.13";
import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

import { buildActivateCard, CARD_HEIGHT, CARD_WIDTH } from "../lib/activate-card.js";
import {
  fontBytes,
  GEOLOGICA_700_BASE64,
  PLUS_JAKARTA_600_BASE64,
} from "../lib/activate-fonts.js";
import { PERCEPTIONX_MARK } from "../lib/activate-mark.js";
import { activatePreview, logoAsset, tokenFromPath } from "../lib/activate-preview.js";

const RESVG_WASM_URL = "https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const WASM_TIMEOUT_MS = 6000;
const FALLBACK_CARD = "/logos/activate-og.png";

// Social platforms cache og:images far longer than any CDN would, so this TTL
// only governs how fast a branding change reaches a *newly* shared link.
const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

const FONTS: Parameters<typeof satori>[1]["fonts"] = [
  { name: "Geologica", data: fontBytes(GEOLOGICA_700_BASE64), weight: 700, style: "normal" },
  {
    name: "Plus Jakarta Sans",
    data: fontBytes(PLUS_JAKARTA_600_BASE64),
    weight: 600,
    style: "normal",
  },
];

// One init per isolate; the promise is the lock, so concurrent crawls of the
// same cold edge node wait on a single wasm fetch instead of racing four.
let wasmReady: Promise<unknown> | null = null;
function ensureWasm(): Promise<unknown> {
  if (!wasmReady) {
    wasmReady = initWasm(
      fetch(RESVG_WASM_URL, { signal: AbortSignal.timeout(WASM_TIMEOUT_MS) }),
    ).catch((err) => {
      // Let the next request try again rather than caching a dead isolate.
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}

export default async (request: Request) => {
  const origin = new URL(request.url).origin;

  try {
    const { branding, reason } = await activatePreview(tokenFromPath(request.url));
    // No client means no logo and no name to take initials from, so the plate
    // carries our own mark rather than rendering as an empty white disc.
    const logo = (branding ? await logoAsset(branding) : null) ?? (branding ? null : PERCEPTIONX_MARK);

    await ensureWasm();

    const card = buildActivateCard({
      displayName: branding?.display_name ?? null,
      tagline: branding?.tagline ?? null,
      primary: branding?.primary_color ?? "#13274F",
      accent: branding?.accent_color ?? "#DB5E89",
      logo,
    });

    // satori's types insist on a ReactNode; it accepts the same plain
    // {type, props} trees at runtime, which is what lets the card live in a
    // dependency-free module that Node can render too.
    const svg = await satori(card as unknown as Parameters<typeof satori>[0], {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: FONTS,
    });

    const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } })
      .render()
      .asPng();

    return new Response(png as unknown as BodyInit, {
      headers: {
        "content-type": "image/png",
        "cache-control": CACHE_CONTROL,
        "netlify-cdn-cache-control": CACHE_CONTROL,
        // Why this card is branded or not, without leaking any value.
        "x-activate-preview": reason,
      },
    });
  } catch {
    return Response.redirect(`${origin}${FALLBACK_CARD}`, 302);
  }
};

export const config = { path: "/activate-og/*" };
