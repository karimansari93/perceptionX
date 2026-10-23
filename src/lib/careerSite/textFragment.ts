// Parsing and locating W3C scroll-to-text fragments (`#:~:text=…`).
//
// Google AI Overviews and AI Mode append one of these to a citation, naming
// the exact passage the answer lifted from the page. No other platform we
// measure does, so this is the only section-level evidence we hold: it is
// real, it is verbatim, and it is partial. Coverage varies by client from
// ~2% to ~21% of that site's citations, so the UI must treat an absent
// highlight as "not quoted by a Google surface", never as "not important".
//
// Grammar (https://wicg.github.io/scroll-to-text-fragment/):
//   text=[prefix-,]textStart[,textEnd][,-suffix]
// and a URL may carry several ranges joined by `&text=`. Every component is
// percent-encoded; commas and dashes inside the quoted prose are escaped, so
// splitting on the raw delimiters is safe before decoding, not after.

export interface TextFragmentRange {
  prefix?: string;
  textStart: string;
  textEnd?: string;
  suffix?: string;
}

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    // A malformed escape upstream should degrade to the raw token, not throw
    // and take the whole passage list down with it.
    return value.replace(/\+/g, ' ');
  }
};

/**
 * Parse the stored fragment (everything after `#:~:text=`) into its ranges.
 * Returns [] for anything that does not yield a usable textStart.
 */
export function parseTextFragment(fragment: string): TextFragmentRange[] {
  if (!fragment) return [];
  // The stored value is the first range already stripped of its `text=`;
  // any further ranges still carry theirs.
  return fragment
    .split(/&text=/)
    .map((spec) => parseRange(spec))
    .filter((r): r is TextFragmentRange => r !== null);
}

function parseRange(spec: string): TextFragmentRange | null {
  if (!spec) return null;
  // Strip any other query-ish tail the citation carried past the fragment.
  const parts = spec.split('&')[0].split(',');
  if (parts.length === 0) return null;

  let prefix: string | undefined;
  let suffix: string | undefined;
  const body = [...parts];

  if (body.length > 1 && body[0].endsWith('-')) {
    prefix = decode(body.shift()!.slice(0, -1));
  }
  if (body.length > 1 && body[body.length - 1].startsWith('-')) {
    suffix = decode(body.pop()!.slice(1));
  }

  const textStart = decode(body[0] ?? '').trim();
  if (!textStart) return null;
  const textEnd = body.length > 1 ? decode(body[body.length - 1]).trim() : undefined;

  return { prefix, textStart, textEnd: textEnd || undefined, suffix };
}

/** A short, readable rendering of the quoted passage for list UI. */
export function describeRange(range: TextFragmentRange): string {
  return range.textEnd ? `${range.textStart} … ${range.textEnd}` : range.textStart;
}

// ─── Locating a range in a rendered capture ─────────────────────────────────

// Whitespace in the captured markup rarely matches the citation's spacing
// (newlines, non-breaking spaces, collapsed indentation), so matching happens
// on a normalized projection of the text with an index back to the real
// nodes.
interface TextIndex {
  text: string;
  nodes: { node: Text; start: number; end: number }[];
}

function buildTextIndex(root: HTMLElement): TextIndex {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: TextIndex['nodes'] = [];
  let text = '';
  let current = walker.nextNode() as Text | null;
  while (current) {
    const normalized = current.data.replace(/\s+/g, ' ');
    if (normalized.trim()) {
      nodes.push({ node: current, start: text.length, end: text.length + normalized.length });
      text += normalized;
    }
    current = walker.nextNode() as Text | null;
  }
  return { text, nodes };
}

const norm = (value: string): string => value.replace(/\s+/g, ' ').trim();

// Map an offset in the normalized projection back to (node, offsetInNode).
function locate(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  for (const entry of index.nodes) {
    if (offset >= entry.start && offset <= entry.end) {
      const within = offset - entry.start;
      // The projection collapsed runs of whitespace, so clamp rather than
      // trust the arithmetic against the node's real length.
      return { node: entry.node, offset: Math.min(within, entry.node.data.length) };
    }
  }
  return null;
}

/**
 * Find a fragment range inside a rendered capture and return its DOM Range.
 * Returns null when the passage is not on the page — captures are taken later
 * than the answer that quoted them, so a page edited since will legitimately
 * no longer contain the text.
 */
export function findRangeInDocument(root: HTMLElement, range: TextFragmentRange): Range | null {
  const index = buildTextIndex(root);
  if (!index.text) return null;

  const haystack = index.text.toLowerCase();
  const start = norm(range.textStart).toLowerCase();
  if (!start) return null;

  // A prefix, when present, disambiguates a passage that repeats.
  let searchFrom = 0;
  if (range.prefix) {
    const prefixAt = haystack.indexOf(norm(range.prefix).toLowerCase());
    if (prefixAt >= 0) searchFrom = prefixAt;
  }

  let startAt = haystack.indexOf(start, searchFrom);
  if (startAt < 0 && searchFrom > 0) startAt = haystack.indexOf(start);
  if (startAt < 0) return null;

  let endOffset = startAt + start.length;
  if (range.textEnd) {
    const end = norm(range.textEnd).toLowerCase();
    const endAt = end ? haystack.indexOf(end, endOffset) : -1;
    if (endAt >= 0) endOffset = endAt + end.length;
  }

  const from = locate(index, startAt);
  const to = locate(index, endOffset);
  if (!from || !to) return null;

  try {
    const domRange = root.ownerDocument.createRange();
    domRange.setStart(from.node, from.offset);
    domRange.setEnd(to.node, to.offset);
    return domRange.collapsed ? null : domRange;
  } catch {
    return null;
  }
}

export interface HighlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Bounding boxes for a located range, in the coordinate space of `root`
 * (scroll included) so an absolutely-positioned overlay can draw them.
 * A passage spanning lines yields one box per line.
 */
export function boxesForRange(root: HTMLElement, range: Range): HighlightBox[] {
  const rootRect = root.getBoundingClientRect();
  const win = root.ownerDocument.defaultView;
  const scrollX = win?.scrollX ?? 0;
  const scrollY = win?.scrollY ?? 0;

  return Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({
      top: r.top - rootRect.top + scrollY,
      left: r.left - rootRect.left + scrollX,
      width: r.width,
      height: r.height,
    }));
}
