import { useEffect, useState } from 'react';
import { fetchStarterQuestions } from '@/services/chatService';

// The four starter questions the connector guide lists — shown until the
// organization's own data-grounded set arrives (or when it has no data yet).
export const FALLBACK_STARTERS: readonly string[] = [
  'Why did our score dip versus last quarter?',
  'What changed on wellbeing, and which sources are behind it?',
  'Which Glassdoor pages come up most, with links?',
  'Show visibility by job function.',
];

const CACHE_TTL_MS = 60 * 60 * 1000;
const cacheKey = (orgId: string) => `px.askAi.starters.${orgId}`;

interface CacheEntry { questions: string[]; cached_at: number }

function readCache(orgId: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(orgId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(entry.questions) || entry.questions.length !== 4) return null;
    if (Date.now() - entry.cached_at > CACHE_TTL_MS) return null;
    return entry.questions;
  } catch { return null; }
}

function writeCache(orgId: string, questions: string[]) {
  try { sessionStorage.setItem(cacheKey(orgId), JSON.stringify({ questions, cached_at: Date.now() } satisfies CacheEntry)); } catch { /* quota */ }
}

/**
 * Starter questions for the welcome screen and the overview chat box. The
 * server builds them from px-tools data (markets, top attribute, top source,
 * job functions) and caches per org for a day; this hook adds a short
 * per-session cache so both surfaces share one fetch.
 */
export function useStarterQuestions(organizationId: string | undefined) {
  const [questions, setQuestions] = useState<string[]>(() => (organizationId && readCache(organizationId)) || [...FALLBACK_STARTERS]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!organizationId) return;
    const cached = readCache(organizationId);
    if (cached) { setQuestions(cached); return; }

    let cancelled = false;
    setIsLoading(true);
    fetchStarterQuestions(organizationId)
      .then(result => {
        if (cancelled) return;
        setQuestions(result.questions);
        writeCache(organizationId, result.questions);
      })
      .catch(err => {
        if (!cancelled) console.warn('Starter questions unavailable, using the guide set:', err);
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId]);

  return { questions, isLoading };
}
