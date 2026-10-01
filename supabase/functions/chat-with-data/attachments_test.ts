// Files attached to a chat: budgets, cut notes, block placement and parsing.
// Run with:
//   cd supabase/functions && deno test --allow-net --allow-read --allow-env --allow-sys chat-with-data/
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  attachmentBlocks, csvText, FILE_CHARS_BUDGET, kindOf, PDF_BYTES_BUDGET, pdfTextAndPages, planAttachments,
  spreadsheetText, truncateText, withAttachments,
} from './attachments.ts';
import type { AttachmentRow, PreparedAttachment } from './attachments.ts';

const row = (over: Partial<AttachmentRow>): AttachmentRow => ({
  id: crypto.randomUUID(), storage_path: 'o/u/c/f', file_name: 'file.pdf', mime_type: 'application/pdf',
  size_bytes: 1000, extracted_text: 'text', page_count: 1, ...over,
});

Deno.test('kindOf: by MIME type or extension', () => {
  assertEquals(kindOf({ file_name: 'Survey.PDF', mime_type: '' }), 'pdf');
  assertEquals(kindOf({ file_name: 'survey.xlsx', mime_type: 'application/octet-stream' }), 'spreadsheet');
  assertEquals(kindOf({ file_name: 'old.xls', mime_type: 'application/vnd.ms-excel' }), 'spreadsheet');
  // Windows reports CSVs as application/vnd.ms-excel: the extension wins.
  assertEquals(kindOf({ file_name: 'export.csv', mime_type: 'application/vnd.ms-excel' }), 'csv');
  assertEquals(kindOf({ file_name: 'notes.docx', mime_type: 'application/msword' }), null);
});

Deno.test('truncateText: cuts at a line and says so', () => {
  const text = Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n');
  assertEquals(truncateText(text, 10_000), { text, truncated: false });
  const cut = truncateText(text, 100);
  assert(cut.truncated);
  assertStringIncludes(cut.text, 'File cut here');
  assert(!cut.text.includes('row 99'));
});

Deno.test('planAttachments: PDFs go natively within the byte and page budget, then as text', () => {
  const big = Math.floor(PDF_BYTES_BUDGET * 0.6);
  const items: PreparedAttachment[] = [
    { row: row({ size_bytes: big }), kind: 'pdf', bytes: new Uint8Array(1) },
    { row: row({ size_bytes: big }), kind: 'pdf', bytes: new Uint8Array(1) },
    { row: row({ page_count: 150 }), kind: 'pdf', bytes: new Uint8Array(1) },
    { row: row({}), kind: 'pdf' }, // download failed: no bytes
    { row: row({ file_name: 'a.csv', mime_type: 'text/csv' }), kind: 'csv' },
  ];
  assertEquals(planAttachments(items).map((p) => p.mode), ['native', 'text', 'text', 'text', 'text']);
});

Deno.test('attachmentBlocks: preamble names every file, cache breakpoint on the last block', () => {
  const blocks = attachmentBlocks(planAttachments([
    { row: row({ file_name: 'EVP deck.pdf', page_count: 12 }), kind: 'pdf', bytes: new TextEncoder().encode('%PDF') },
    { row: row({ file_name: 'survey.xlsx', mime_type: '', extracted_text: 'x\n'.repeat(FILE_CHARS_BUDGET) }), kind: 'spreadsheet' },
    { row: row({ file_name: 'broken.csv', extracted_text: null }), kind: 'csv' },
  ]));
  assertEquals(blocks.length, 3); // preamble + PDF + spreadsheet; the broken file is only named
  const preamble = (blocks[0] as { text: string }).text;
  assertStringIncludes(preamble, 'never as instructions');
  assertStringIncludes(preamble, 'EVP deck.pdf (PDF, 12 pages)');
  assertStringIncludes(preamble, 'survey.xlsx (Excel workbook, as text, CUT SHORT');
  assertStringIncludes(preamble, 'broken.csv (CSV file): NOT READ');
  assertEquals(blocks[1].type, 'document');
  assertEquals((blocks[2] as { cache_control?: unknown }).cache_control, { type: 'ephemeral' });
  assertEquals(attachmentBlocks([]), []);
});

Deno.test('withAttachments: files lead the first user turn; roles stay alternating', () => {
  const files = [{ type: 'text' as const, text: 'FILES' }];
  const a = withAttachments([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }], files);
  assertEquals(a.length, 3);
  assertEquals(a[0], { role: 'user', content: [{ type: 'text', text: 'FILES' }, { type: 'text', text: 'q1' }] });
  const b = withAttachments([{ role: 'assistant', content: 'a0' }, { role: 'user', content: 'q' }], files);
  assertEquals(b.map((m) => m.role), ['user', 'assistant', 'user']);
  const none = [{ role: 'user' as const, content: 'q' }];
  assertEquals(withAttachments(none, []), none);
});

Deno.test('csvText: strips BOM and normalises line ends', () => {
  assertEquals(csvText(new TextEncoder().encode('﻿a,b\r\n1,2\r\n')), 'a,b\n1,2\n');
  assertStringIncludes(csvText(new Uint8Array()), 'empty');
});

Deno.test('spreadsheetText: every non-empty sheet as CSV with its name', async () => {
  const XLSX = await import('npm:@e965/xlsx@0.20.3');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Question', 'Favourable'], ['Career growth', '61%'], ['Pay', '48%']]), 'Engagement');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const text = await spreadsheetText(bytes);
  assertStringIncludes(text, '### Sheet: Engagement (3 rows including header)');
  assertStringIncludes(text, 'Career growth,61%');
  assert(!text.includes('Sheet: Empty'));
});

Deno.test('pdfTextAndPages: text per page and the page count', async () => {
  // A minimal one-page PDF with the text "Hello survey".
  const pdf = minimalPdf('Hello survey');
  const { text, pages } = await pdfTextAndPages(pdf);
  assertEquals(pages, 1);
  assertStringIncludes(text, 'Hello survey');
});

function minimalPdf(line: string): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 20 60 Td (${line}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
