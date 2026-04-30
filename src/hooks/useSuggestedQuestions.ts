import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const STATIC_FALLBACK = [
  'How is our brand perceived across AI models right now?',
  'What themes come up most often in AI responses about us?',
  'Which competitors are AI models mentioning alongside us?',
  'Which sources are AI models citing when they describe us?',
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_PREFIX = 'px.suggestedQuestions.';

interface CacheEntry {
  questions: string[];
  has_data: boolean;
  cached_at: number;
}

/**
 * Loads AI-generated starter questions personalized to the caller's data.
 * Caches per-org in localStorage for 24h so the dashboard doesn't re-call
 * Claude on every visit. Always returns *something* displayable — falls
 * back to a static set on any failure.
 */
export function useSuggestedQuestions(organizationId: string | undefined) {
  const [questions, setQuestions] = useState<string[]>(STATIC_FALLBACK);
  const [hasData, setHasData] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const inflightRef = useRef<AbortController | null>(null);

  const cacheKey = organizationId ? `${CACHE_PREFIX}${organizationId}` : null;

  const readCache = useCallback((): CacheEntry | null => {
    if (!cacheKey) return null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry;
      if (!entry || typeof entry.cached_at !== 'number') return null;
      if (Date.now() - entry.cached_at > CACHE_TTL_MS) return null;
      if (!Array.isArray(entry.questions) || !entry.questions.length) return null;
      return entry;
    } catch {
      return null;
    }
  }, [cacheKey]);

  const writeCache = useCallback((entry: CacheEntry) => {
    if (!cacheKey) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch { /* quota */ }
  }, [cacheKey]);

  const fetchQuestions = useCallback(async (force = false) => {
    if (!organizationId) return;

    if (!force) {
      const cached = readCache();
      if (cached) {
        setQuestions(cached.questions);
        setHasData(cached.has_data);
        return;
      }
    }

    // Cancel any in-flight request if we're re-fetching.
    if (inflightRef.current) inflightRef.current.abort();
    const ac = new AbortController();
    inflightRef.current = ac;

    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/suggest-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ organizationId }),
        signal: ac.signal,
      });

      if (!res.ok) throw new Error(`suggest-questions ${res.status}`);
      const body = await res.json();
      const qs = Array.isArray(body.questions) && body.questions.length > 0
        ? body.questions.slice(0, 4)
        : STATIC_FALLBACK;
      const hd = !!body.has_data;

      setQuestions(qs);
      setHasData(hd);
      writeCache({ questions: qs, has_data: hd, cached_at: Date.now() });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.warn('Failed to load suggested questions, using fallback:', err);
      // Keep the static fallback already shown — don't flash an empty state.
    } finally {
      if (inflightRef.current === ac) inflightRef.current = null;
      setIsLoading(false);
    }
  }, [organizationId, readCache, writeCache]);

  useEffect(() => {
    fetchQuestions(false);
    return () => {
      if (inflightRef.current) inflightRef.current.abort();
    };
  }, [fetchQuestions]);

  return {
    questions,
    hasData,
    isLoading,
    refresh: () => fetchQuestions(true),
  };
}
