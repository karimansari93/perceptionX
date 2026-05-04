import { useCallback, useEffect, useState } from "react";

// Persists the user's preferred dashboard view (location + period) in
// localStorage so it auto-restores on next login. Toggle semantics: clicking
// the star saves the current view, clicking again clears it. Default state
// (no starred view) falls back to "All" (no location filter, latest period).

export interface StarredView {
  location: string | null;
  period: string | null;
}

const STORAGE_KEY_PREFIX = "dashboard.starredView";

export function starredViewStorageKey(userId: string | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}:${userId ?? "anon"}`;
}

export function readStarredView(userId: string | null | undefined): StarredView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(starredViewStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      location: typeof parsed.location === "string" ? parsed.location : null,
      period: typeof parsed.period === "string" ? parsed.period : null,
    };
  } catch {
    return null;
  }
}

function writeStarred(userId: string | null | undefined, view: StarredView | null) {
  if (typeof window === "undefined") return;
  try {
    if (view === null) {
      window.localStorage.removeItem(starredViewStorageKey(userId));
    } else {
      window.localStorage.setItem(starredViewStorageKey(userId), JSON.stringify(view));
    }
  } catch {
    /* swallow quota / privacy-mode errors */
  }
}

export function useStarredView(userId: string | null | undefined) {
  // Keep state in React so toggles re-render the star button immediately.
  const [starredView, setStarredView] = useState<StarredView | null>(() => readStarredView(userId));

  // Re-read when userId changes (different user logs in).
  useEffect(() => {
    setStarredView(readStarredView(userId));
  }, [userId]);

  const saveCurrentView = useCallback(
    (view: StarredView) => {
      writeStarred(userId, view);
      setStarredView(view);
    },
    [userId],
  );

  const clearStarred = useCallback(() => {
    writeStarred(userId, null);
    setStarredView(null);
  }, [userId]);

  return { starredView, saveCurrentView, clearStarred };
}
