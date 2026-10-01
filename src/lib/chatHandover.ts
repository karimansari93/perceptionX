// Files attached in the overview's chat box ride to /chat with the question.
// File objects stay in memory here rather than in router state, and are
// cleared once the question has been sent.

let pendingFiles: File[] = [];

export function setHandoverFiles(files: File[]): void {
  pendingFiles = [...files];
}

export function peekHandoverFiles(): File[] {
  return pendingFiles;
}

export function clearHandoverFiles(): void {
  pendingFiles = [];
}
