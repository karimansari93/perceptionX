// Corporate Outlook blocks images that load from the web until the reader
// clicks "Download pictures", and most never do (Ford, 2026-11-03). Images
// carried inside the message as inline attachments show straight away, so
// every remote image is fetched, attached with a content id and referenced
// as cid:. An image that cannot be fetched keeps its web address.

export interface InlineAttachment { filename: string; content: string; content_id: string; content_type: string }

const MAX_IMAGES = 40;
const MAX_TOTAL_BYTES = 3_000_000;

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const decodeAmp = (u: string) => u.replace(/&amp;/g, '&');

export async function inlineImages(
  html: string, fetcher: typeof fetch = fetch,
): Promise<{ html: string; attachments: InlineAttachment[] }> {
  const urls = Array.from(new Set(Array.from(html.matchAll(/<img\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi), m => m[1]))).slice(0, MAX_IMAGES);
  const fetched = await Promise.all(urls.map(async (url, i) => {
    try {
      const res = await fetcher(decodeAmp(url), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
      if (!type.startsWith('image/')) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png';
      return { url, bytes, type, id: `img${i + 1}`, ext };
    } catch { return null; }
  }));
  let total = 0;
  let out = html;
  const attachments: InlineAttachment[] = [];
  for (const f of fetched) {
    if (!f || total + f.bytes.length > MAX_TOTAL_BYTES) continue;
    total += f.bytes.length;
    attachments.push({ filename: `${f.id}.${f.ext}`, content: toBase64(f.bytes), content_id: f.id, content_type: f.type });
    out = out.split(`src="${f.url}"`).join(`src="cid:${f.id}"`);
  }
  return { html: out, attachments };
}
