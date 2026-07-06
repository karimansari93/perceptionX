import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";

// A "seed" lets the global command palette pre-fill a destination tab's search
// box, so selecting e.g. a competitor lands you on the Competitors tab already
// filtered to it. The nonce makes re-selecting the same term re-apply.
type Seed = { query: string; nonce: number };
type SeedMap = Record<string, Seed>;

interface TabSearchSeedValue {
  seeds: SeedMap;
  seedTabSearch: (section: string, query: string) => void;
}

const TabSearchSeedContext = createContext<TabSearchSeedValue | null>(null);

export function TabSearchSeedProvider({ children }: { children: ReactNode }) {
  const [seeds, setSeeds] = useState<SeedMap>({});

  const seedTabSearch = useCallback((section: string, query: string) => {
    setSeeds(prev => ({
      ...prev,
      [section]: { query, nonce: (prev[section]?.nonce ?? 0) + 1 },
    }));
  }, []);

  const value = useMemo(() => ({ seeds, seedTabSearch }), [seeds, seedTabSearch]);

  return <TabSearchSeedContext.Provider value={value}>{children}</TabSearchSeedContext.Provider>;
}

/** Writer side — used by the command palette to seed a tab's search. Safe no-op
 *  when rendered outside a provider. */
export function useSeedTabSearch() {
  return useContext(TabSearchSeedContext)?.seedTabSearch ?? (() => {});
}

/** Reader side — a tab calls this to apply an incoming seed to its own search
 *  state. Fires on the first mount if a seed is already pending, and again each
 *  time the palette seeds this section. No-op outside a provider. */
export function useTabSearchSeed(section: string, apply: (query: string) => void) {
  const ctx = useContext(TabSearchSeedContext);
  const nonce = ctx?.seeds[section]?.nonce ?? 0;
  useEffect(() => {
    if (nonce > 0 && ctx) apply(ctx.seeds[section].query);
    // Intentionally keyed on nonce only: re-apply on each seed, not on every
    // keystroke the user later types into the tab's own box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
}
