// Files a user can attach to an Ask PerceptionX question: PDFs, Excel
// workbooks and CSVs (an internal survey, an EVP deck), read by the analyst
// alongside the PerceptionX data. Limits match the chat-attachments bucket
// (supabase/migrations/20260929120000_chat_attachments.sql).

export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

/** For the file input's accept attribute. */
export const ACCEPT_ATTR = '.pdf,.xlsx,.xls,.csv';

/** The question sent when the user attaches files without typing one. */
export const DEFAULT_FILE_QUESTION = 'Summarise the key insights in the attached files and how they compare with our PerceptionX data.';

export const extensionOf = (name: string) => (name.toLowerCase().split('.').pop() ?? '');

/**
 * The content type to store a file under, from its extension: browsers report
 * CSVs inconsistently (Windows says application/vnd.ms-excel, some say
 * nothing), and the bucket only accepts the four types above.
 */
export function contentTypeFor(name: string): string | null {
  return TYPES[extensionOf(name)] ?? null;
}

/** A file name safe to use as the last segment of a storage path. */
export function storageSafeName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').replace(/^\.+/, '');
  return (cleaned || 'file').slice(-120);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Adds picked or dropped files to the ones already attached: known types
 * only, within the size limit, no duplicates, at most MAX_FILES_PER_MESSAGE.
 * Returns the new list and a message for each file that was turned away.
 */
export function addFiles(existing: File[], incoming: File[]): { files: File[]; errors: string[] } {
  const files = [...existing];
  const errors: string[] = [];
  for (const f of incoming) {
    if (!contentTypeFor(f.name)) { errors.push(`${f.name}: only PDF, Excel (.xlsx, .xls) and CSV files can be attached.`); continue; }
    if (f.size === 0) { errors.push(`${f.name} is empty.`); continue; }
    if (f.size > MAX_FILE_BYTES) { errors.push(`${f.name} is ${formatBytes(f.size)}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`); continue; }
    if (files.some(x => x.name === f.name && x.size === f.size)) continue;
    if (files.length >= MAX_FILES_PER_MESSAGE) { errors.push(`You can attach up to ${MAX_FILES_PER_MESSAGE} files to one question.`); break; }
    files.push(f);
  }
  return { files, errors };
}
