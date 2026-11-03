import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { inlineImages } from './inline-images.ts';

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const fakeFetch = (async (url: string) => {
  if (url.includes('broken')) return new Response('no', { status: 404 });
  return new Response(png, { headers: { 'content-type': 'image/png' } });
}) as unknown as typeof fetch;

Deno.test('remote images become inline attachments; a failed fetch keeps its address', async () => {
  const html = '<img alt="a" src="https://app.example/logo.png"><img src="https://img.logo.dev/ford.com?token=x&amp;size=36">' +
    '<img src="https://app.example/logo.png"><img src="https://app.example/broken.png">';
  const { html: out, attachments } = await inlineImages(html, fakeFetch);
  assertEquals(attachments.length, 2);
  assertEquals(attachments[0].content_id, 'img1');
  assert(!out.includes('https://app.example/logo.png'));
  assertEquals(out.split('cid:img1').length - 1, 2, 'the same image is attached once and used twice');
  assert(out.includes('cid:img2'));
  assert(out.includes('https://app.example/broken.png'));
});
