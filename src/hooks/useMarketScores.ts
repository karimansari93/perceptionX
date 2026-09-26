import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Anonymous peer statistics for one company in one market, from
// get_market_peer_stats. Other companies' names and individual scores are
// never sent to the client: only ranges, averages and the sorted peer
// sentiment values (for "higher than N of M peers").
export interface Range {
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface MarketPeerStats {
  peerCount: number;
  eps: Range;
  visibility: Range;
  sentiment: Range & { values: number[] };
  relevance: Range;
}

const EMPTY_RANGE: Range = { min: null, max: null, avg: null };
export const EMPTY_PEER_STATS: MarketPeerStats = {
  peerCount: 0,
  eps: EMPTY_RANGE,
  visibility: EMPTY_RANGE,
  sentiment: { ...EMPTY_RANGE, values: [] },
  relevance: EMPTY_RANGE,
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRange = (r: any): Range => ({ min: toNum(r?.min), max: toNum(r?.max), avg: toNum(r?.avg) });

interface State {
  data: MarketPeerStats;
  loading: boolean;
  error: string | null;
}

export function useMarketPeerStats(
  companyName: string | null | undefined,
  market: string | null | undefined,
): State {
  const [state, setState] = useState<State>({ data: EMPTY_PEER_STATS, loading: false, error: null });

  useEffect(() => {
    if (!companyName || !market) {
      setState({ data: EMPTY_PEER_STATS, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: EMPTY_PEER_STATS, loading: true, error: null });

    (async () => {
      const { data, error } = await supabase.rpc("get_market_peer_stats" as never, {
        p_company_name: companyName,
        p_market: market,
      } as never);

      if (cancelled) return;
      if (error) {
        setState({ data: EMPTY_PEER_STATS, loading: false, error: error.message });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      setState({
        data: {
          peerCount: Number(raw.peer_count ?? 0),
          eps: toRange(raw.eps),
          visibility: toRange(raw.visibility),
          sentiment: {
            ...toRange(raw.sentiment),
            values: ((raw.sentiment?.values ?? []) as unknown[])
              .map(toNum)
              .filter((v): v is number => v !== null),
          },
          relevance: toRange(raw.relevance),
        },
        loading: false,
        error: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [companyName, market]);

  return state;
}
