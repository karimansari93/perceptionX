// Bakes public/logos/activate-og.png — the card an Activate link preview falls
// back to when the per-token render at the edge can't run (unknown token,
// Supabase unreachable, the resvg wasm fetch failing, a crawler that timed us
// out). It is the same tree netlify/edge-functions/activate-og.ts draws, just
// with no employer name and PerceptionX's own colours, so the fallback never
// looks like a different product from the real thing.
//
// Ad-hoc like the rest of scripts/ — satori and resvg only exist to produce a
// committed PNG, so they stay out of the app's dependency tree:
//
//   npm i --no-save satori@0.10.13 @resvg/resvg-js@2.6.2
//   node scripts/build-activate-og-fallback.mjs
//
// Pass --refresh-fonts to re-download the two latin subsets from fontsource
// and rewrite netlify/lib/activate-fonts.js before rendering.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FONT_SOURCES = [
  {
    export: 'GEOLOGICA_700_BASE64',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/geologica@latest/latin-700-normal.ttf',
  },
  {
    export: 'PLUS_JAKARTA_600_BASE64',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-600-normal.ttf',
  },
];

async function refreshFonts() {
  const blocks = [];
  for (const font of FONT_SOURCES) {
    const res = await fetch(font.url);
    if (!res.ok) throw new Error(`${font.url} -> ${res.status}`);
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    blocks.push(`/** @type {string} */\nexport const ${font.export} =\n  '${b64}';`);
    console.log(`  ${font.export}: ${(b64.length / 1024).toFixed(0)}KB`);
  }
  const header = [
    '// Latin subsets of the two PerceptionX faces, inlined as base64.',
    '//',
    '// satori needs real font bytes and an edge function has no filesystem, so the',
    '// alternative was a third fetch at crawl time. The card render already depends',
    '// on fetching the resvg wasm; every extra hop is another way for a WhatsApp',
    '// preview to come back blank, and 70KB of glyphs is a cheap way to delete two',
    '// of them. Sources: fontsource geologica@700, plus-jakarta-sans@600 (latin).',
    '//',
    '// Regenerate with: node scripts/build-activate-og-fallback.mjs --refresh-fonts',
    '',
  ].join('\n');
  const helper = [
    '',
    '/** base64 -> ArrayBuffer, the shape satori wants for font data. */',
    'export function fontBytes(b64) {',
    '  const bin = atob(b64);',
    '  const out = new Uint8Array(bin.length);',
    '  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',
    '  return out.buffer;',
    '}',
    '',
  ].join('\n');
  writeFileSync(
    path.join(root, 'netlify/lib/activate-fonts.js'),
    `${header}\n${blocks.join('\n\n')}\n${helper}`,
  );
}

async function main() {
  if (process.argv.includes('--refresh-fonts')) {
    console.log('refreshing fonts...');
    await refreshFonts();
  }

  let satori;
  let Resvg;
  try {
    satori = (await import('satori')).default;
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch {
    console.error(
      'Missing render deps. Run:\n  npm i --no-save satori@0.10.13 @resvg/resvg-js@2.6.2',
    );
    process.exit(1);
  }

  const { buildActivateCard, CARD_WIDTH, CARD_HEIGHT } = await import(
    path.join(root, 'netlify/lib/activate-card.js')
  );
  const { GEOLOGICA_700_BASE64, PLUS_JAKARTA_600_BASE64, fontBytes } = await import(
    path.join(root, 'netlify/lib/activate-fonts.js')
  );

  // No employer name means no initials to fall back on, so the disc carries
  // our own mark rather than sitting empty.
  const mark = readFileSync(path.join(root, 'public/logos/P-Icon-Dark-medium.png'));
  const svg = await satori(
    buildActivateCard({
      displayName: null,
      tagline: null,
      // PerceptionX nightsky/pink, so an unbranded fallback still reads as ours.
      primary: '#13274F',
      accent: '#DB5E89',
      logo: `data:image/png;base64,${mark.toString('base64')}`,
    }),
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: [
        { name: 'Geologica', data: fontBytes(GEOLOGICA_700_BASE64), weight: 700, style: 'normal' },
        {
          name: 'Plus Jakarta Sans',
          data: fontBytes(PLUS_JAKARTA_600_BASE64),
          weight: 600,
          style: 'normal',
        },
      ],
    },
  );

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } })
    .render()
    .asPng();
  const out = path.join(root, 'public/logos/activate-og.png');
  writeFileSync(out, png);
  console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)}KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
