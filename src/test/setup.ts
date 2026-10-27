import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';
import { SUPABASE_HOST } from './msw/supabase';
import { clearRecentDashboardErrors } from '@/lib/observability';

// ---- jsdom polyfills for the dashboard tree ----
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
(globalThis as any).ResizeObserver ??= NoopObserver;
(globalThis as any).IntersectionObserver ??= NoopObserver;
Element.prototype.scrollIntoView ??= function () {};
// Radix primitives (Select, Popover) probe pointer capture on open.
(HTMLElement.prototype as any).hasPointerCapture ??= () => false;
(HTMLElement.prototype as any).setPointerCapture ??= () => {};
(HTMLElement.prototype as any).releasePointerCapture ??= () => {};

// ---- MSW lifecycle ----
// Started at setup-file top level, NOT in beforeAll: supabase-js (and its
// GoTrue client) capture the global `fetch` reference when the client module
// is imported, which happens before beforeAll runs. MSW must have patched
// fetch by then or every dashboard request goes to the real network.
server.listen({
  // Every request to the (fake) Supabase host must be answered by a handler
  // — an unhandled one is a test bug, not a network condition. Anything
  // else (favicon CDNs, fonts) is irrelevant to the dashboard's data path.
  onUnhandledRequest(request) {
    if (new URL(request.url).host === SUPABASE_HOST) {
      throw new Error(`Unhandled Supabase request in test: ${request.method} ${request.url}`);
    }
  },
});
// Vitest's jsdom environment swaps in jsdom's AbortController/AbortSignal, but
// fetch (and the Request MSW builds from each call) is Node's, which rejects a
// signal that is not its own: "Expected signal to be an instance of
// AbortSignal". React Query hands every dashboard query a jsdom signal, so take
// it off the request and honour the abort here. Installed after server.listen
// so it wraps MSW's fetch, and before any test imports the Supabase client.
const mswFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const signal = init?.signal;
  if (!signal || !(signal instanceof AbortSignal)) return mswFetch(input, init);
  const abortError = () => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    mswFetch(input, { ...init, signal: undefined })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
};
beforeAll(() => { /* server already listening (see above) */ });
afterEach(() => {
  server.resetHandlers();
  cleanup();
  clearRecentDashboardErrors();
  localStorage.clear();
  sessionStorage.clear();
});
afterAll(() => server.close());
