import { useCallback, useEffect, useState } from "react";

// Persists the user's preferred dashboard view (location + period) in
// localStorage so it auto-restores on next login. Toggle semantics: clicking
// the star saves the current view, clicking again clears it. Default state
// (no starred view) falls back to "All" (no location filter, latest period).

export interface StarredView {
  location: string | null;
  period: string | null;
  // Company the view was saved on. The view only auto-applies when that
  // company is active — a location starred on company A must not leak onto
  // company B (it would either mis-scope B or be silently reset). null on
  // legacy entries saved before this field existed; those apply to any
  // company (old behavior) until re-starred.
  companyId?: string | null;
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
      companyId: typeof parsed.companyId === "string" ? parsed.companyId : null,
    };
  } catch {
    return null;
  }
}

// Whether a stored view should apply while `companyId` is the active company.
// Legacy views (no companyId) apply anywhere; new views only on their company.
export function starredViewAppliesTo(
  view: StarredView | null,
  companyId: string | null | undefined
): boolean {
  if (!view) return false;
  return view.companyId == null || view.companyId === (companyId ?? null);
}

// One-time migration for legacy entries: stamp the company the view first
// applies on, so it stops applying to every company from then on. Best-effort
// guess (the legacy record carries no company info), but it matches what the
// old behavior did on login — just made sticky instead of repeated.
export function stampStarredViewCompany(
  userId: string | null | undefined,
  companyId: string
): void {
  const view = readStarredView(userId);
  if (view && view.companyId == null) {
    writeStarred(userId, { ...view, companyId });
  }
}

// Fired after every write so mounted useStarredView instances stay in sync
// with module-level writes (e.g. stampStarredViewCompany from
// useDashboardData) — localStorage "storage" events only fire cross-tab.
const CHANGE_EVENT = "starred-view-changed";

function writeStarred(userId: string | null | undefined, view: StarredView | null) {
  if (typeof window === "undefined") return;
  try {
    if (view === null) {
      window.localStorage.removeItem(starredViewStorageKey(userId));
    } else {
      window.localStorage.setItem(starredViewStorageKey(userId), JSON.stringify(view));
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId: userId ?? null } }));
  } catch {
    /* swallow quota / privacy-mode errors */
  }
}

export function useStarredView(userId: string | null | undefined) {
  // Keep state in React so toggles re-render the star button immediately.
  const [starredView, setStarredView] = useState<StarredView | null>(() => readStarredView(userId));

  // Re-read when userId changes (different user logs in), and whenever any
  // code path writes the stored view (star toggles elsewhere, the legacy
  // companyId stamp) so this instance can't render a stale star.
  useEffect(() => {
    setStarredView(readStarredView(userId));
    const onChange = () => setStarredView(readStarredView(userId));
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
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
