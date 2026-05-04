import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useCompetitorBenchmarks } from "@/hooks/useCompetitorBenchmarks";
import { useMarketScores, MarketScoreRow } from "@/hooks/useMarketScores";
import {
  getPositionLabel,
  PositionLabel,
} from "@/lib/getPositionLabel";
import { marketNameFromLocation } from "@/lib/marketName";
import { DiscoveryStats } from "@/lib/discoveryStats";

interface EpsDrilldownSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  score: number;
  label: string;
  companyName: string;
  market: string | null | undefined;
  // Live values from the dashboard breakdown — source of truth for the
  // displayed component value. The MV is used only for peer_avg.
  liveSentiment: number;
  liveVisibility: number;
  // Discovery-prompt visibility: target's mention rate on open-ended
  // ("best employers in X") prompts plus the top entities the AI surfaces
  // in those same responses. Computed from `responses` in OverviewTab.
  discoveryStats: DiscoveryStats | null;
  // Top job functions covered (count of responses), formatted as a comma-
  // separated string e.g. "Software Engineering (412), Product (88)".
  topJobFunctions?: string;
}

interface MetricBarProps {
  label: string;
  value: number | null;
  unit?: string;
  peerMin?: number | null;
  peerMax?: number | null;
  comingSoon?: boolean;
}

function MetricBar({ label, value, unit = "%", peerMin, peerMax, comingSoon }: MetricBarProps) {
  const v = value ?? 0;
  const min = peerMin ?? 0;
  const max = peerMax ?? 0;
  const hasPeerRange = !comingSoon && peerMin !== null && peerMax !== null && peerMin !== undefined && peerMax !== undefined;

  return (
    <div className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 py-2">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="relative h-2">
        <div className="absolute inset-0 rounded-full bg-gray-100" />
        {hasPeerRange && (
          <div
            className="absolute h-full rounded-full bg-gray-300"
            style={{
              left: `${Math.max(0, min)}%`,
              width: `${Math.max(0, Math.min(100, max) - Math.max(0, min))}%`,
            }}
          />
        )}
        {!comingSoon && value !== null && (
          <div
            className="absolute top-1/2 w-3 h-3 rounded-full bg-[#0DBCBA] ring-2 ring-white -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${Math.max(0, Math.min(100, v))}%` }}
            title={`${companyLabel(label)}: ${v.toFixed(0)}${unit}`}
          />
        )}
      </div>
      <div className="text-right min-w-[6rem]">
        {comingSoon ? (
          <span className="text-xs text-gray-500">Coming soon</span>
        ) : (
          <>
            <span className="text-sm font-semibold text-gray-900">
              {value !== null ? `${value.toFixed(0)}${unit}` : "—"}
            </span>
            {hasPeerRange && (
              <div className="text-[11px] text-gray-500 leading-tight">
                peers {min.toFixed(0)}–{max.toFixed(0)}{unit}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function companyLabel(_l: string) {
  return "your score";
}

function computePeerRanges(rows: MarketScoreRow[], targetCompany: string) {
  const peers = rows.filter((r) => r.company_name !== targetCompany);
  const range = (key: "visibility_pct" | "sentiment_pct" | "relevance_pct") => {
    const vals = peers
      .map((p) => p[key])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (vals.length === 0) return { min: null as number | null, max: null as number | null };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };
  // Per-peer EPS using the same dashboard formula, all from MV values.
  const epsVals = peers
    .map((p) => {
      if (p.sentiment_pct === null || p.visibility_pct === null || p.relevance_pct === null) return null;
      return p.sentiment_pct * 0.5 + p.visibility_pct * 0.3 + p.relevance_pct * 0.2;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const epsRange =
    epsVals.length > 0 ? { min: Math.min(...epsVals), max: Math.max(...epsVals) } : { min: null, max: null };
  return {
    eps: epsRange,
    sentiment: range("sentiment_pct"),
    visibility: range("visibility_pct"),
    relevance: range("relevance_pct"),
  };
}

function fmtPct(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)}%`;
}

function fmtPts(gap: number): string {
  const sign = gap > 0 ? "+" : "";
  return `${sign}${gap.toFixed(1)} pts`;
}

function formatRatioNumber(r: number): string {
  if (r >= 100) return `${Math.round(r)}`;
  if (r >= 10) return `${Math.round(r)}`;
  return r.toFixed(1);
}

function formatVisibilityRatio(targetPct: number, entityPct: number, _companyName: string): string {
  // target effectively zero → AI doesn't surface the target at all
  if (targetPct < 0.5) {
    if (entityPct >= 1) return `mentioned far more often`;
    return `rarely mentioned`;
  }
  if (entityPct === 0) return `rarely mentioned`;
  if (entityPct > targetPct) {
    const ratio = entityPct / targetPct;
    if (ratio < 1.2) return `mentioned about as often`;
    return `mentioned ${formatRatioNumber(ratio)}× more often`;
  }
  const ratio = targetPct / entityPct;
  if (ratio < 1.2) return `mentioned about as often`;
  return `mentioned ${formatRatioNumber(ratio)}× less often`;
}

function positionBadgeClass(label: PositionLabel): string {
  switch (label) {
    case "Leading peer set":
      return "bg-green-100 text-green-800 border-green-200";
    case "Above peer benchmark":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "In line with peers":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "Below peer benchmark":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "Trailing peer benchmark":
      return "bg-red-50 text-red-800 border-red-200";
  }
}

function buildSummary(
  discoveryStats: DiscoveryStats | null,
  companyName: string,
  sentimentGap: number | null,
): string {
  const parts: string[] = [];

  if (discoveryStats && discoveryStats.topEntities.length > 0) {
    const target = discoveryStats.targetVisibilityPct;
    const top = discoveryStats.topEntities[0];
    if (target < 0.5) {
      parts.push(`${top.name} is mentioned far more often than ${companyName} in this market`);
    } else if (top.pct > target * 1.2) {
      const ratio = top.pct / target;
      parts.push(`${top.name} is mentioned ${formatRatioNumber(ratio)}× more often than ${companyName}`);
    } else if (target > top.pct * 1.2) {
      const ratio = target / top.pct;
      parts.push(`${companyName} is mentioned ${formatRatioNumber(ratio)}× more often than ${top.name}`);
    } else {
      parts.push(`${companyName} and ${top.name} are mentioned at similar rates`);
    }
  }

  if (sentimentGap !== null) {
    const label = getPositionLabel(sentimentGap);
    if (label === "Leading peer set" || label === "Above peer benchmark") {
      parts.push(`sentiment is ${label === "Leading peer set" ? "leading" : "above"} the peer benchmark (${fmtPts(sentimentGap)})`);
    } else if (label === "In line with peers") {
      parts.push(`sentiment is in line with peers`);
    } else {
      parts.push(`sentiment is ${label === "Trailing peer benchmark" ? "trailing" : "below"} the peer benchmark (${fmtPts(sentimentGap)})`);
    }
  }

  if (parts.length === 0) return "Comparison data isn't available for this market yet.";
  return parts.join("; ") + ".";
}

export function EpsDrilldownSheet({
  open,
  onOpenChange,
  score,
  label,
  companyName,
  market,
  liveSentiment,
  liveVisibility,
  discoveryStats,
  topJobFunctions,
}: EpsDrilldownSheetProps) {
  const marketName = marketNameFromLocation(market);
  const { data, loading, error } = useCompetitorBenchmarks(companyName, marketName);
  const { data: marketRows } = useMarketScores(marketName);
  const peerRanges = computePeerRanges(marketRows, companyName);

  const sentimentGap =
    data && data.sentiment_peer_avg !== null && !Number.isNaN(data.sentiment_peer_avg)
      ? liveSentiment - data.sentiment_peer_avg
      : null;
  const sentimentLabel = sentimentGap !== null ? getPositionLabel(sentimentGap) : null;

  // ----- AI summary: auto-generated when the sheet opens -----
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiThinkingStep, setAiThinkingStep] = useState<number>(-1);
  // Track the (company, market) we've fetched for, so opening the sheet again
  // for the same context doesn't re-fetch, but switching markets/companies does.
  const lastFetchKeyRef = useRef<string>("");

  // Each step previews one of the sections the user will see below.
  const aiThinkingSteps = [
    "Reading the data…",
    "Writing the summary…",
    "Comparing scores to peer ranges…",
    "Ranking visibility vs other companies…",
    "Comparing sentiment vs other companies…",
  ];

  const fetchAiAnalysis = async () => {
    // Capture the key this fetch is for. If the user switches market/company
    // before the response lands, we'll discard stale results.
    const fetchKey = `${companyName}::${marketName ?? ""}`;
    setAiAnalysis("");
    setAiError(null);
    setAiLoading(true);
    setAiThinkingStep(0);
    // Step the thinking indicator forward at a steady cadence so the user
    // sees us "working through" the sections that will appear below.
    const thinkingTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < aiThinkingSteps.length; i++) {
      thinkingTimers.push(setTimeout(() => setAiThinkingStep(i), i * 900));
    }

    const epsLine = peerRanges.eps.min !== null && peerRanges.eps.max !== null
      ? `${score} (${label}). Peer EPS in this market ranges from ${peerRanges.eps.min.toFixed(0)} to ${peerRanges.eps.max.toFixed(0)}.`
      : `${score} (${label}).`;
    const sentLine = peerRanges.sentiment.min !== null && peerRanges.sentiment.max !== null
      ? `${liveSentiment.toFixed(0)}%. Peer sentiment ranges ${peerRanges.sentiment.min.toFixed(0)}–${peerRanges.sentiment.max.toFixed(0)}%.`
      : `${liveSentiment.toFixed(0)}%.`;

    // Visibility — DO NOT pass raw percentages for the comparison. We only give
    // the AI multiplicative ratios from open-ended search data, because the
    // visibility percentages are computed on different prompt mixes for the
    // target vs the panel and aren't directly comparable as %.
    const topEntitiesLine =
      discoveryStats && discoveryStats.topEntities.length > 0
        ? discoveryStats.topEntities
            .slice(0, 3)
            .map((e) => {
              const target = discoveryStats.targetVisibilityPct;
              if (target < 0.5) return `${e.name} (mentioned far more often than ${companyName})`;
              const ratio = e.pct / target;
              return `${e.name} (mentioned ${ratio.toFixed(1)}× more often than ${companyName})`;
            })
            .join(", ")
        : null;

    const prompt = `You are a senior employer-brand analyst. Give the client concise, authoritative context for ${companyName}'s Employer Perception Score${marketName ? ` in ${marketName}` : ""}. The client already knows the score; they want perspective from the data.

Data:
- Market: ${marketName || "global / unspecified"}
- EPS: ${epsLine}
- Sentiment: ${sentLine}${topJobFunctions ? `\n- Job functions covered (count of responses): ${topJobFunctions}.` : ""}${topEntitiesLine ? `\n- Visibility comparison (open-ended employer searches${marketName ? ` in ${marketName}` : ""}): ${topEntitiesLine}.` : ""}${sentimentGap !== null ? `\n- Sentiment gap vs peer benchmark: ${sentimentGap > 0 ? "+" : ""}${sentimentGap.toFixed(1)} pts.` : ""}

Write a short, actionable analysis with two sections. Each section uses a markdown bold header on its own line, followed by ONE or TWO short sentences. Total output is short — keep it tight. Where the data points to a specific market or job function, name it explicitly.

**Where ${companyName} stands**
Name a specific lead and a specific gap vs peers, with concrete data, grounded in the market${marketName ? ` (${marketName})` : ""} and a relevant job function if the data supports it. Open this section's content with "${companyName}${marketName ? ` in ${marketName}` : ""}" as the subject.

**Your move**
One concrete, actionable recommendation to lift the score — the single biggest opportunity from the data — ideally targeted at a specific job function or talent segment.

Hard rules:
- **Never express visibility differences in percentages OR percentage points.** Do not write "73% vs 99%", "26-point visibility deficit", "trails by 12 pts on visibility", "visibility gap of 25%", or any similar phrasing. Visibility comparisons MUST always be multiplicative ratios from the data above, e.g. "Microsoft is mentioned 7× more often than ${companyName}".
- Sentiment differences can be discussed as percentages or point gaps — that's apples-to-apples.
- EPS can be referenced as a number (e.g. "${companyName}'s 78 sits above the peer range of 62–77").
- Be direct, professional, authoritative. No hedging, no preamble, no summary paragraph.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAiError("Authentication required");
        setAiLoading(false);
        return;
      }
      const res = await fetch(
        "https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-claude",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            prompt,
            enableWebSearch: false,
            // Use Haiku for short structured summaries: higher rate-limit
            // tier than Sonnet 4, faster, sufficient quality for our format.
            model: "claude-haiku-4-5",
            maxTokens: 800,
          }),
        },
      );
      const json = await res.json();
      if (lastFetchKeyRef.current !== fetchKey) return;
      if (json.response) {
        setAiAnalysis(json.response.trim());
      } else {
        const isRateLimit = /rate limit|429/i.test(json.error || "");
        setAiError(
          isRateLimit
            ? "We're a bit overloaded right now — give it a moment."
            : "Couldn't generate the summary. Try again?",
        );
      }
    } catch {
      if (lastFetchKeyRef.current !== fetchKey) return;
      setAiError("Couldn't generate the summary. Try again?");
    } finally {
      if (lastFetchKeyRef.current === fetchKey) {
        setAiLoading(false);
        setAiThinkingStep(-1);
      }
      thinkingTimers.forEach(clearTimeout);
    }
  };

  // Auto-generate the AI summary whenever the sheet is opened for a new
  // (company, market) pair. Reset stale results when the key changes so
  // switching markets re-fetches.
  useEffect(() => {
    const key = `${companyName}::${marketName ?? ""}`;
    if (key !== lastFetchKeyRef.current) {
      setAiAnalysis("");
      setAiError(null);
      setAiLoading(false);
    }
    if (open && key !== lastFetchKeyRef.current) {
      lastFetchKeyRef.current = key;
      fetchAiAnalysis();
    }
    // fetchAiAnalysis intentionally omitted from deps — it closes over current
    // state setters and prop values, which is what we want at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyName, marketName]);

  // Stagger-reveal the lower sections after the AI Summary finishes. Cards
  // below stay hidden while the summary is generating, then cascade in once
  // the AI returns (or errors out).
  const [revealStep, setRevealStep] = useState(0);
  useEffect(() => {
    if (!open) {
      setRevealStep(0);
      return;
    }
    if (aiLoading) {
      // AI is still generating — keep the cards below hidden.
      setRevealStep(0);
      return;
    }
    if (aiAnalysis || aiError) {
      // AI is done — cascade the rest in.
      const timers = [
        setTimeout(() => setRevealStep(1), 200),
        setTimeout(() => setRevealStep(2), 500),
        setTimeout(() => setRevealStep(3), 800),
      ];
      return () => timers.forEach(clearTimeout);
    }
  }, [open, aiLoading, aiAnalysis, aiError]);

  const revealClass = (step: number) =>
    `transition-all duration-500 ease-out ${
      revealStep >= step ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
    }`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Your Score</SheetTitle>
          <SheetDescription>
            What {companyName}'s score{marketName ? ` in ${marketName}` : ""} means, how it compares and where to focus.
          </SheetDescription>
        </SheetHeader>

        {/* SECTION 0 — AI-generated summary (auto-fires on open) */}
        <section className="mb-8">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            AI Summary
          </h3>
          <div className="rounded-xl border bg-gradient-to-br from-[#0DBCBA]/5 to-[#0DBCBA]/10 border-[#0DBCBA]/30 p-4">
            {aiLoading ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative">
                    <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                    <div className="absolute inset-0 animate-ping">
                      <Sparkles className="w-4 h-4 text-[#0DBCBA] opacity-30" />
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-[#0A8B89]">Thinking…</span>
                </div>
                <div className="space-y-1">
                  {aiThinkingSteps.map((step, i) => {
                    const isActive = i === aiThinkingStep;
                    const isComplete = i < aiThinkingStep;
                    const isPending = i > aiThinkingStep;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 py-1"
                        style={{
                          opacity: isPending ? 0.35 : 1,
                          transform: isPending ? "translateX(4px)" : "translateX(0)",
                          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                      >
                        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                          {isComplete ? (
                            <CheckCircle2 className="w-4 h-4 text-[#0DBCBA]" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 text-[#0DBCBA] animate-spin" />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                          )}
                        </div>
                        <span
                          className={`text-sm ${
                            isActive
                              ? "text-[#0A8B89] font-medium"
                              : isComplete
                                ? "text-[#0DBCBA]"
                                : "text-gray-400"
                          }`}
                        >
                          {step}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : aiError ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-red-700">{aiError}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    lastFetchKeyRef.current = "";
                    fetchAiAnalysis();
                  }}
                  className="text-xs"
                >
                  Retry
                </Button>
              </div>
            ) : aiAnalysis ? (
              <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none prose-p:my-2 prose-p:text-gray-700">
                <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Generating summary…</div>
            )}
          </div>
        </section>

        {/* SECTION 1 — score breakdown with peer ranges */}
        <section className={`mb-8 ${revealClass(1)}`}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Your scores vs peer ranges
          </h3>
          <div className="rounded-xl border bg-white p-4">
            <MetricBar
              label="EPS (Overall)"
              value={score}
              unit=""
              peerMin={peerRanges.eps.min}
              peerMax={peerRanges.eps.max}
            />
            <MetricBar
              label="Sentiment"
              value={liveSentiment}
              peerMin={peerRanges.sentiment.min}
              peerMax={peerRanges.sentiment.max}
            />
            <MetricBar
              label="Visibility"
              value={liveVisibility}
              peerMin={peerRanges.visibility.min}
              peerMax={peerRanges.visibility.max}
            />
            <MetricBar label="Relevance" value={null} comingSoon />
          </div>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            EPS scale: Poor &lt;50 · Fair 50–64 · Good 65–79 · Excellent 80+.
          </p>
        </section>

        {/* SECTION 2 — visibility vs other companies (built from open-ended prompts) */}
        <section className={`mb-8 ${revealClass(2)}`}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Visibility vs other companies{marketName ? ` in ${marketName}` : ""}
          </h3>

          {!discoveryStats || discoveryStats.topEntities.length === 0 ? (
            <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
              Not enough data yet for this period.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-white">
              {discoveryStats.topEntities.map((entity) => {
                const targetPct = discoveryStats.targetVisibilityPct;
                const moreVisible = entity.pct > targetPct;
                const ratio =
                  moreVisible && targetPct > 0
                    ? entity.pct / targetPct
                    : !moreVisible && entity.pct > 0
                      ? targetPct / entity.pct
                      : 1;
                const colorClass =
                  ratio < 1.2 ? "text-gray-600" : moreVisible ? "text-[#DB5E89]" : "text-[#0DBCBA]";
                return (
                  <div key={entity.name} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="text-sm text-gray-900 truncate">{entity.name}</div>
                    <span className={`text-sm font-medium shrink-0 ${colorClass}`}>
                      {formatVisibilityRatio(targetPct, entity.pct, companyName)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION 3 — sentiment vs other companies in market */}
        <section className={`mb-8 ${revealClass(3)}`}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Sentiment vs other companies{marketName ? ` in ${marketName}` : ""}
          </h3>

          {(() => {
            const peers = marketRows
              .filter((r) => r.company_name !== companyName && r.sentiment_pct !== null)
              .map((r) => ({
                name: r.company_name,
                pct: r.sentiment_pct as number,
                delta: (r.sentiment_pct as number) - liveSentiment,
              }))
              .sort((a, b) => b.delta - a.delta);

            if (peers.length === 0) {
              return (
                <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
                  Not enough data yet for this market.
                </div>
              );
            }

            return (
              <div className="divide-y rounded-xl border bg-white">
                {peers.map((peer) => {
                  const absDelta = Math.abs(peer.delta);
                  const inLine = absDelta < 1;
                  const peerHigher = peer.delta > 0;
                  const colorClass = inLine
                    ? "text-gray-600"
                    : peerHigher
                      ? "text-[#0DBCBA]"
                      : "text-[#DB5E89]";
                  const text = inLine
                    ? `in line`
                    : peerHigher
                      ? `+${absDelta.toFixed(1)}% vs you`
                      : `−${absDelta.toFixed(1)}% vs you`;
                  return (
                    <div key={peer.name} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="text-sm text-gray-900 truncate">{peer.name}</div>
                      <span className={`text-sm font-medium shrink-0 ${colorClass}`}>{text}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>

      </SheetContent>
    </Sheet>
  );
}
