// Platform-appropriate keyboard hint for the search launcher (⌘K / Ctrl K).
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
export const SEARCH_SHORTCUT = isMac ? "⌘K" : "Ctrl K";
