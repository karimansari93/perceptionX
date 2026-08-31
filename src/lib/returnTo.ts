// Preserves the in-app URL a logged-out user was trying to reach (e.g. the
// MCP OAuth consent page, /connect/consent?request_id=…) across the login
// flow. sessionStorage rather than router state because full-page auth
// round trips (email links, Google) drop location.state.
//
// Only same-origin paths are ever stored or replayed ("/…", never "//…" or
// absolute URLs), so this can't become an open redirect.

const KEY = 'px_return_to';

export function stashReturnTo(path: string): void {
  try {
    if (path.startsWith('/') && !path.startsWith('//')) sessionStorage.setItem(KEY, path);
  } catch { /* storage unavailable — login just lands on the default page */ }
}

export function consumeReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (!v) return null;
    sessionStorage.removeItem(KEY);
    return v.startsWith('/') && !v.startsWith('//') ? v : null;
  } catch {
    return null;
  }
}
