import { useEffect, useState } from 'react';
import { fetchStarterQuestions, type Starter } from '@/services/chatService';

// The four starter questions the connector guide lists — shown until the
// organization's own data-grounded set arrives (or when it has no data yet).
export const FALLBACK_STARTERS: readonly Starter[] = [
  { title: 'Why did our score dip versus last quarter?', sub: 'EPS versus the previous quarter' },
  { title: 'What changed on wellbeing, and which sources are behind it?', sub: 'Themes and the sources behind them' },
  { title: 'Which Glassdoor pages come up most, with links?', sub: 'The pages AI actually cites' },
  { title: 'Show visibility by job function.', sub: 'Visibility split by function' },
];

const CACHE_TTL_MS = 60 * 60 * 1000;
const cacheKey = (orgId: string) => `px.askAi.starters.v2.${orgId}`;

interface CacheEntry { starters: Starter[]; cached_at: number }

function readCache(orgId: string): Starter[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(orgId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(entry.starters) || entry.starters.length !== 4) return null;
    if (Date.now() - entry.cached_at > CACHE_TTL_MS) return null;
    return entry.starters;
  } catch { return null; }
}

function writeCache(orgId: string, starters: Starter[]) {
  try { sessionStorage.setItem(cacheKey(orgId), JSON.stringify({ starters, cached_at: Date.now() } satisfies CacheEntry)); } catch { /* quota */ }
}

/**
 * Starter questions for the Ask AI page and the overview chat box. The
 * server builds them from px-tools data (markets, top attribute, top source,
 * job functions) with a one-line sub for each, and caches per org for a day;
 * this hook adds a short per-session cache so both surfaces share one fetch.
 */
export function useStarterQuestions(organizationId: string | undefined) {
  const [starters, setStarters] = useState<Starter[]>(() => (organizationId && readCache(organizationId)) || [...FALLBACK_STARTERS]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!organizationId) return;
    const cached = readCache(organizationId);
    if (cached) { setStarters(cached); return; }

    let cancelled = false;
    setIsLoading(true);
    fetchStarterQuestions(organizationId)
      .then(result => {
        if (cancelled) return;
        setStarters(result.starters);
        writeCache(organizationId, result.starters);
      })
      .catch(err => {
        if (!cancelled) console.warn('Starter questions unavailable, using the guide set:', err);
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId]);

  return { starters, questions: starters.map(s => s.title), isLoading };
}
