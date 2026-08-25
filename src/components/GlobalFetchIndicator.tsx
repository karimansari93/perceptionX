import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

// Thin top progress bar for genuinely-async moments. Appears only after a
// fetch has been in flight for 150ms (fast operations never flash it) and
// stays at least 300ms once shown (no flicker on quick bursts). Purely
// informative — pointer events pass through.
export const GlobalFetchIndicator = () => {
  const active = useIsFetching() + useIsMutating();
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active > 0 && !visible) {
      const t = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, 150);
      return () => clearTimeout(t);
    }
    if (active === 0 && visible) {
      const remaining = Math.max(0, 300 - (Date.now() - shownAt.current));
      const t = window.setTimeout(() => setVisible(false), remaining);
      return () => clearTimeout(t);
    }
  }, [active, visible]);

  if (!visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-0.5 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="h-full w-1/3 rounded-full bg-pink-500/80 animate-global-fetch" />
    </div>
  );
};
