import { lazy, ComponentType } from 'react';

/**
 * Drop-in replacement for React.lazy that recovers from stale-deploy chunk
 * errors.
 *
 * When a new build is deployed while a user has the old app open, the old
 * index.html references chunk filenames (e.g. CompetitorsTab-<oldhash>.js) that
 * no longer exist. Navigating to that lazy route 404s the chunk; with the SPA
 * redirect (/* -> /index.html) + `X-Content-Type-Options: nosniff`, the browser
 * gets text/html and throws "Failed to load module script ... MIME type".
 *
 * This wrapper catches that failed dynamic import and triggers a single full
 * reload to pick up the fresh build, instead of crashing the route. A
 * sessionStorage flag prevents an infinite reload loop if the failure is real
 * (e.g. the chunk is genuinely broken, not just stale).
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  const STORAGE_KEY = 'lazyChunkReloaded';
  return lazy(async () => {
    try {
      const component = await factory();
      // Successful load — clear the guard so a future stale deploy can reload.
      window.sessionStorage.removeItem(STORAGE_KEY);
      return component;
    } catch (error) {
      const alreadyReloaded = window.sessionStorage.getItem(STORAGE_KEY) === 'true';
      if (!alreadyReloaded) {
        // Likely a stale chunk after a deploy — reload once to get the new build.
        window.sessionStorage.setItem(STORAGE_KEY, 'true');
        window.location.reload();
        // Keep React.lazy suspended while the reload happens.
        return new Promise<{ default: T }>(() => {});
      }
      // Already reloaded once and still failing — surface the real error.
      throw error;
    }
  });
}
