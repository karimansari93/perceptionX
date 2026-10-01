import { useCallback, useRef, useState, DragEvent } from 'react';
import { FileSpreadsheet, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { ACCEPT_ATTR, addFiles, extensionOf, formatBytes, MAX_FILES_PER_MESSAGE } from '@/lib/chatAttachments';
import { attachmentDownloadUrl, type ChatAttachment } from '@/services/chatService';
import { cn } from '@/lib/utils';

// The files attached to the question being written, with drag and drop.
export function useFileDraft() {
  const [files, setFilesState] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  const setFiles = useCallback((next: File[]) => { filesRef.current = next; setFilesState(next); }, []);
  const [dragging, setDragging] = useState(false);
  const add = useCallback((incoming: File[]) => {
    const { files: next, errors } = addFiles(filesRef.current, incoming);
    errors.forEach(e => toast.error(e));
    setFiles(next);
  }, [setFiles]);
  const remove = useCallback((i: number) => setFiles(filesRef.current.filter((_, j) => j !== i)), [setFiles]);
  const clear = useCallback(() => setFiles([]), [setFiles]);
  const dropProps = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); },
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      add(Array.from(e.dataTransfer.files));
    },
  };
  return { files, add, remove, clear, dragging, dropProps };
}

// Paperclip: opens the file picker.
export function AttachButton({ onFiles, disabled, count = 0 }: { onFiles: (files: File[]) => void; disabled?: boolean; count?: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = count >= MAX_FILES_PER_MESSAGE;
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || full}
        aria-label="Attach files"
        title={full ? `Up to ${MAX_FILES_PER_MESSAGE} files per question` : 'Attach PDF, Excel or CSV files'}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#13274F] disabled:opacity-40"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
      />
    </>
  );
}

const iconFor = (name: string) => (extensionOf(name) === 'pdf' ? FileText : FileSpreadsheet);

// One file: name, size, and remove (while drafting) or download (once sent).
export function AttachmentChip({ name, size, onRemove, attachment, className }: {
  name: string; size: number; onRemove?: () => void; attachment?: ChatAttachment; className?: string;
}) {
  const Icon = iconFor(name);
  const [opening, setOpening] = useState(false);
  const uploaded = !!attachment?.storage_path;
  const open = useCallback(async () => {
    if (!attachment || !uploaded) return;
    setOpening(true);
    try {
      window.location.assign(await attachmentDownloadUrl(attachment));
    } catch (err: any) {
      toast.error(err.message || 'Could not open the file');
    } finally {
      setOpening(false);
    }
  }, [attachment, uploaded]);

  const body = (
    <>
      {opening || (attachment && !uploaded) ? <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-gray-400" /> : <Icon className="h-3.5 w-3.5 flex-none text-[#DB5E89]" />}
      <span className="min-w-0 truncate font-medium">{name}</span>
      <span className="flex-none text-gray-400">{formatBytes(size)}</span>
    </>
  );
  const chip = 'inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-[#13274F]';

  if (attachment) {
    return (
      <button type="button" onClick={open} disabled={!uploaded || opening} title={uploaded ? `Download ${name}` : 'Uploading...'} className={cn(chip, 'hover:border-[#DB5E89]', className)}>
        {body}
      </button>
    );
  }
  return (
    <span className={cn(chip, className)}>
      {body}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="-mr-0.5 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// The drafted files above the composer input, with the privacy line.
export function DraftAttachments({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="mb-2.5">
      <div className="flex flex-wrap gap-1.5">
        {files.map((f, i) => <AttachmentChip key={`${f.name}-${f.size}-${i}`} name={f.name} size={f.size} onRemove={() => onRemove(i)} />)}
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">Files are private to you and used only to answer your questions.</p>
    </div>
  );
}

export const dropRing = (dragging: boolean) => (dragging ? 'border-[#DB5E89] ring-2 ring-[#DB5E89]/20' : '');
