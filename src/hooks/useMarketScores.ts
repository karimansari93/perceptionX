import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface MarketScoreRow {
  company_name: string;
  market: string;
  visibility_pct: number | null;
  sentiment_pct: number | null;
  relevance_pct: number | null;
}

interface State {
  data: MarketScoreRow[];
  loading: boolean;
  error: string | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function useMarketScores(market: string | null | undefined): State {
  const [state, setState] = useState<State>({ data: [], loading: false, error: null });

  useEffect(() => {
    if (!market) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: [], loading: true, error: null });

    (async () => {
      const { data, error } = await (supabase as any)
        .from("competitor_benchmarks_mv")
        .select("company_name, market, visibility_pct, sentiment_pct, relevance_pct")
        .eq("market", market);

      if (cancelled) return;
      if (error) {
        setState({ data: [], loading: false, error: error.message });
        return;
      }

      const rows = ((data ?? []) as any[]).map((r) => ({
        company_name: r.company_name,
        market: r.market,
        visibility_pct: toNum(r.visibility_pct),
        sentiment_pct: toNum(r.sentiment_pct),
        relevance_pct: toNum(r.relevance_pct),
      }));

      setState({ data: rows, loading: false, error: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [market]);

  return state;
}
