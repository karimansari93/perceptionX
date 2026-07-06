import { lazy, type ComponentType } from "react";

/**
 * Drop-in replacement for React.lazy that recovers from stale-deploy chunk
 * failures.
 *
 * When a new build is deployed, the hashed chunk filenames change. A browser
 * tab still running the previous index.html will request the old /assets/*.js
 * on first navigation to a lazy route. Those files no longer exist, so the SPA
 * host serves index.html in their place — the browser then rejects the module
 * with "Expected a JavaScript module but got text/html" and the dynamic import
 * rejects, tripping the ErrorBoundary.
 *
 * The fix: on the first such failure, force a one-time hard reload so the tab
 * picks up the fresh index.html (and therefore the current chunk manifest). A
 * sessionStorage guard prevents a reload loop when the chunk is genuinely
 * broken rather than merely stale — in that case we rethrow so the
 * ErrorBoundary can show the real error.
 */
const RELOAD_FLAG = "chunk-reload-attempted";

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const component = await factory();
      // Loaded fine — clear the guard so a future stale deploy can reload again.
      window.sessionStorage.removeItem(RELOAD_FLAG);
      return component;
    } catch (error) {
      const alreadyReloaded = window.sessionStorage.getItem(RELOAD_FLAG);
      if (!alreadyReloaded) {
        window.sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
        // Never resolve: keep Suspense's fallback up until the reload navigates
        // the page away. Resolving/rejecting here would flash the error UI.
        return new Promise<{ default: T }>(() => {});
      }
      // Reloaded once and it still fails — this is a real error, not a stale
      // chunk. Surface it to the ErrorBoundary.
      throw error;
    }
  });
}
