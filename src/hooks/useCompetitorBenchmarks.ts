import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CompetitorBenchmarksRow {
  company_name: string;
  market: string;
  visibility_pct: number | null;
  visibility_peer_avg: number | null;
  visibility_gap: number | null;
  sentiment_pct: number | null;
  sentiment_peer_avg: number | null;
  sentiment_gap: number | null;
  relevance_pct: number | null;
  relevance_peer_avg: number | null;
  relevance_gap: number | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceRow(raw: any): CompetitorBenchmarksRow {
  return {
    company_name: raw.company_name,
    market: raw.market,
    visibility_pct: toNum(raw.visibility_pct),
    visibility_peer_avg: toNum(raw.visibility_peer_avg),
    visibility_gap: toNum(raw.visibility_gap),
    sentiment_pct: toNum(raw.sentiment_pct),
    sentiment_peer_avg: toNum(raw.sentiment_peer_avg),
    sentiment_gap: toNum(raw.sentiment_gap),
    relevance_pct: toNum(raw.relevance_pct),
    relevance_peer_avg: toNum(raw.relevance_peer_avg),
    relevance_gap: toNum(raw.relevance_gap),
  };
}

interface State {
  data: CompetitorBenchmarksRow | null;
  loading: boolean;
  error: string | null;
}

export function useCompetitorBenchmarks(
  companyName: string | null | undefined,
  market: string | null | undefined,
): State {
  const [state, setState] = useState<State>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!companyName || !market) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: null, loading: true, error: null });

    (async () => {
      const { data, error } = await (supabase as any)
        .from("competitor_benchmarks_mv")
        .select(
          "company_name, market, visibility_pct, visibility_peer_avg, visibility_gap, sentiment_pct, sentiment_peer_avg, sentiment_gap, relevance_pct, relevance_peer_avg, relevance_gap",
        )
        .eq("company_name", companyName)
        .eq("market", market)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
        return;
      }

      setState({ data: data ? coerceRow(data) : null, loading: false, error: null });
    })();

    return () => {
      cancelled = true;
    };
  }, [companyName, market]);

  return state;
}
