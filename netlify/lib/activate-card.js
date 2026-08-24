// The share card drawn for an Activate link, plus the copy that surrounds it.
//
// Pure and I/O-free on purpose: the same tree is rasterised by satori+resvg in
// the Netlify edge function (per token, at crawl time) and by the Node script
// that bakes the generic fallback card (scripts/build-activate-og-fallback.mjs).
// One definition, so the two can never drift.
//
// The canvas is the client's primary colour and the highlights are their
// accent, exactly as the live page reads them — a recipient who taps through
// from the preview should land somewhere that looks like the card they tapped.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Design handoff's AA mechanism: luminance > 0.45 -> navy ink, else white. */
export function onColor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return '#FFFFFF';
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(v.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#13274F' : '#FFFFFF';
}

/** #RRGGBB -> rgba(), for ink tints that work over either canvas polarity. */
export function tint(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

export function initialsFor(displayName) {
  return String(displayName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/** The line on the card itself. Names the employer, states what the page is. */
export function cardHeadline(displayName) {
  return displayName
    ? `Where AI learns about working at ${displayName}`
    : 'Where AI learns about working here';
}

/**
 * Title and description for the link preview.
 *
 * Invitation framing: the recipient is getting this from their own employer's
 * talent team, forwarded into a WhatsApp thread or an email, and the preview
 * has to answer "why am I being sent this" before they will tap. Naming the
 * team who sent it does that; the page beyond it stays non-directive.
 */
export function previewCopy(displayName) {
  if (!displayName) {
    return {
      title: 'Add your voice to what AI says about your employer',
      description:
        'Your talent team asked us to show you where AI is getting its answers about working here.',
    };
  }
  return {
    title: `${displayName} — add your voice to what AI says about us`,
    description: `The ${displayName} talent team asked us to show you where AI is getting its answers about working here.`,
  };
}

/** Long employer names still have to fit on one card. */
function headlineSize(text) {
  if (text.length > 62) return 46;
  if (text.length > 44) return 54;
  return 64;
}

/**
 * satori element tree for the card.
 *
 * `logo` is a data URI resolved by the caller rather than a remote URL: it
 * keeps satori off the network, so a slow or dead logo host costs nothing at
 * crawl time and simply falls through to initials.
 */
export function buildActivateCard({ displayName, primary, accent, logo }) {
  const bg = primary || '#13274F';
  const ink = onColor(bg);
  const highlight = accent || ink;
  const headline = cardHeadline(displayName);
  const initials = initialsFor(displayName);

  const mark = logo
    ? {
        type: 'img',
        props: { src: logo, width: 92, height: 92, style: { objectFit: 'contain' } },
      }
    : {
        type: 'div',
        props: {
          style: { display: 'flex', fontFamily: 'Geologica', fontWeight: 700, fontSize: 46, color: bg },
          children: initials,
        },
      };

  return {
    type: 'div',
    props: {
      style: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        backgroundColor: bg,
        position: 'relative',
      },
      children: [
        // Accent wash bleeding off the bottom-right corner. Carries the second
        // brand colour without competing with the headline for the reader.
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              right: -180,
              bottom: -260,
              width: 620,
              height: 620,
              borderRadius: 310,
              backgroundColor: tint(highlight, 0.16),
              display: 'flex',
            },
          },
        },
        // The client's mark, in the white disc the welcome screen uses.
        {
          type: 'div',
          props: {
            style: {
              width: 140,
              height: 140,
              borderRadius: 70,
              backgroundColor: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // A near-white brand canvas would otherwise lose the disc edge.
              border: `1px solid ${tint(ink, 0.12)}`,
            },
            children: [mark],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    fontFamily: 'Plus Jakarta Sans',
                    fontWeight: 600,
                    fontSize: 22,
                    letterSpacing: 3,
                    color: tint(ink, 0.66),
                    marginBottom: 18,
                  },
                  children: 'PERCEPTIONX ACTIVATE',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    fontFamily: 'Geologica',
                    fontWeight: 700,
                    fontSize: headlineSize(headline),
                    lineHeight: 1.14,
                    letterSpacing: -1,
                    color: ink,
                    maxWidth: 900,
                  },
                  children: headline,
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: 48,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: highlight,
                    marginRight: 20,
                    display: 'flex',
                  },
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    fontFamily: 'Plus Jakarta Sans',
                    fontWeight: 600,
                    fontSize: 26,
                    color: tint(ink, 0.82),
                  },
                  children: 'perceptionx.ai',
                },
              },
            ],
          },
        },
      ],
    },
  };
}
