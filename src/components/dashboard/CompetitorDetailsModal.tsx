import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { X, ExternalLink, ChevronDown, ChevronUp, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCompetitorFavicon, getFavicon } from "@/utils/citationUtils";
import { getAttributeIconByName } from "@/config/attributeIcons";
import { getLLMDisplayName } from "@/config/llmLogos";
import { sentimentRatioV2 } from "@/lib/sentimentV2";
import { containsWholeWord, escapeRegExp } from "@/utils/competitorDetection";
import LLMLogo from "@/components/LLMLogo";
import type { CompetitorNormalizedResponse } from "./CompetitorsTab";

// Mirrors SourceDetailsModal: right-hand sheet, header with identity +
// count badge, then a single scroll of sections.
//
// Sections:
//   1. Head-to-head scorecard (visibility, sentiment, freshness)
//   2. Function profile (coverage per job function vs their average)
//   3. Market profile (same across markets)
//   4. Unique attributes (either side described where the other isn't)
//   5. Order position (who's named first when both appear)
//   6. Losing prompts (discovery answers where they appear and you don't)
//   7. Competitor-only cited domains (links into the Sources tab)

const BRAND_COLOR = "#0DBCBA";
const COMPETITOR_COLOR = "#64748B";
const PROFILE_MIN_ANSWERS = 3;
const LOSING_PROMPT_LIMIT = 8;
const DOMAIN_PREVIEW_LIMIT = 12;
const ORDER_POSITION_TEXT_CAP = 200;

interface CompetitorDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  competitorName: string;
  companyName: string;
  companyId?: string;
  /** Every in-scope response for the current period (job-function filtered). */
  analyzedResponses: CompetitorNormalizedResponse[];
  totals: { total: number; companyMentioned: number };
  competitorAgg: { count: number; coMention: number; responseIds: string[] } | null;
  competitorThemeAgg: {
    positive: number;
    negative: number;
    byResponse: Map<string, Set<string>>;
    attrNames: Map<string, string>;
  } | null;
  /** Whether ANY competitor theme rows exist for this company yet — decides
   *  between "no data for this competitor" and "the pipeline hasn't emitted
   *  triples yet". */
  hasCompetitorThemeData: boolean;
  companySentimentById: Map<string, number | null>;
  domainRecencyAvg: Map<string, number>;
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  onOpenSourcesForDomain?: (domain: string) => void;
}

export const CompetitorDetailsModal = ({
  isOpen,
  onClose,
  competitorName,
  companyName,
  companyId,
  analyzedResponses,
  totals,
  competitorAgg,
  competitorThemeAgg,
  hasCompetitorThemeData,
  companySentimentById,
  domainRecencyAvg,
  responseTexts = {},
  fetchResponseTexts,
  onOpenSourcesForDomain,
}: CompetitorDetailsModalProps) => {
  const [expandedPromptIdx, setExpandedPromptIdx] = useState<number | null>(null);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [fetchedTexts, setFetchedTexts] = useState<Record<string, string>>({});

  // ai_themes rows (measured company) for co-mention responses — the company
  // side of the unique-attributes comparison. Fetched on open, chunked.
  const [companyAttrByResponse, setCompanyAttrByResponse] = useState<Map<string, Set<string>> | null>(null);
  const [companyAttrNames, setCompanyAttrNames] = useState<Map<string, string>>(new Map());

  const competitorResponses = useMemo(
    () => analyzedResponses.filter((nr) => nr.competitors.includes(competitorName)),
    [analyzedResponses, competitorName],
  );

  const coMentionResponses = useMemo(
    () => competitorResponses.filter((nr) => nr.mentioned),
    [competitorResponses],
  );

  // ---------------------------------------------------------------------
  // Section 1 — head-to-head scorecard
  // ---------------------------------------------------------------------
  const scorecard = useMemo(() => {
    const companyVisibility = totals.total > 0 ? (totals.companyMentioned / totals.total) * 100 : 0;
    const competitorVisibility = totals.total > 0 && competitorAgg
      ? (competitorAgg.count / totals.total) * 100
      : 0;

    // Company sentiment: positive share of opinionated themes over in-scope
    // responses that have signal (methodology v2).
    let companyRatioSum = 0;
    let companyRatioN = 0;
    for (const nr of analyzedResponses) {
      const ratio = companySentimentById.get(nr.id);
      if (typeof ratio === "number") {
        companyRatioSum += ratio;
        companyRatioN += 1;
      }
    }
    const companySentiment = companyRatioN > 0 ? (companyRatioSum / companyRatioN) * 100 : null;
    const competitorSentimentRatio = competitorThemeAgg
      ? sentimentRatioV2(competitorThemeAgg.positive, competitorThemeAgg.negative)
      : null;
    const competitorSentiment = competitorSentimentRatio !== null ? competitorSentimentRatio * 100 : null;

    // Freshness: average recency of domains cited in the responses where each
    // side appears (0-100, higher = fresher sources).
    const avgFreshness = (rows: CompetitorNormalizedResponse[]): number | null => {
      let sum = 0;
      let n = 0;
      for (const nr of rows) {
        for (const d of nr.domains) {
          const score = domainRecencyAvg.get(d);
          if (typeof score === "number") {
            sum += score;
            n += 1;
          }
        }
      }
      return n > 0 ? sum / n : null;
    };
    const companyFreshness = avgFreshness(analyzedResponses.filter((nr) => nr.mentioned));
    const competitorFreshness = avgFreshness(competitorResponses);

    return {
      visibility: { company: companyVisibility, competitor: competitorVisibility },
      sentiment: { company: companySentiment, competitor: competitorSentiment },
      freshness: { company: companyFreshness, competitor: competitorFreshness },
    };
  }, [analyzedResponses, competitorResponses, totals, competitorAgg, competitorThemeAgg, companySentimentById, domainRecencyAvg]);

  // ---------------------------------------------------------------------
  // Sections 2 + 3 — function / market profiles: competitor coverage within
  // each segment vs their all-scope average, sorted by deviation.
  // ---------------------------------------------------------------------
  const buildProfile = (
    keyOf: (nr: CompetitorNormalizedResponse) => string | null,
    fallbackLabel: string,
  ) => {
    const totalsBySeg = new Map<string, number>();
    const hitsBySeg = new Map<string, number>();
    for (const nr of analyzedResponses) {
      const key = keyOf(nr) ?? fallbackLabel;
      totalsBySeg.set(key, (totalsBySeg.get(key) || 0) + 1);
      if (nr.competitors.includes(competitorName)) {
        hitsBySeg.set(key, (hitsBySeg.get(key) || 0) + 1);
      }
    }
    const overall = totals.total > 0 && competitorAgg ? (competitorAgg.count / totals.total) * 100 : 0;
    return Array.from(totalsBySeg.entries())
      .filter(([, n]) => n >= PROFILE_MIN_ANSWERS)
      .map(([segment, n]) => {
        const coverage = ((hitsBySeg.get(segment) || 0) / n) * 100;
        return { segment, n, coverage, deviation: coverage - overall };
      })
      .sort((a, b) => b.deviation - a.deviation);
  };

  const functionProfile = useMemo(
    () => buildProfile((nr) => nr.jobFunction, "Unspecified"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyzedResponses, competitorName, totals, competitorAgg],
  );

  const marketProfile = useMemo(
    () => buildProfile((nr) => nr.location, "Unspecified"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyzedResponses, competitorName, totals, competitorAgg],
  );

  const overallCoverage = totals.total > 0 && competitorAgg
    ? (competitorAgg.count / totals.total) * 100
    : 0;

  // ---------------------------------------------------------------------
  // Section 4 — unique attributes. Company side needs ai_themes rows for the
  // co-mention responses; fetched once per open.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;
    setCompanyAttrByResponse(null);
    const ids = coMentionResponses.map((nr) => nr.id);
    if (ids.length === 0 || !companyId) {
      setCompanyAttrByResponse(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const map = new Map<string, Set<string>>();
      const names = new Map<string, string>();
      const CHUNK = 150;
      for (let i = 0; i < ids.length && i < 900; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from("ai_themes")
          .select("response_id, attribute_id, attribute_name")
          .eq("company_id", companyId)
          .in("response_id", chunk);
        if (cancelled) return;
        if (error) {
          console.warn("ai_themes fetch for unique attributes failed:", error.message);
          break;
        }
        for (const row of data ?? []) {
          if (!row.attribute_id || row.attribute_id === "unknown") continue;
          let set = map.get(row.response_id);
          if (!set) {
            set = new Set();
            map.set(row.response_id, set);
          }
          set.add(row.attribute_id);
          if (row.attribute_name && !names.has(row.attribute_id)) {
            names.set(row.attribute_id, row.attribute_name);
          }
        }
      }
      if (!cancelled) {
        setCompanyAttrByResponse(map);
        setCompanyAttrNames(names);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, companyId, coMentionResponses]);

  const uniqueAttributes = useMemo(() => {
    if (!companyAttrByResponse) return null; // loading
    const companyOnly = new Map<string, number>();
    const competitorOnly = new Map<string, number>();
    const compByResponse = competitorThemeAgg?.byResponse ?? new Map<string, Set<string>>();
    for (const nr of coMentionResponses) {
      const companyAttrs = companyAttrByResponse.get(nr.id) ?? new Set<string>();
      const compAttrs = compByResponse.get(nr.id) ?? new Set<string>();
      for (const a of companyAttrs) {
        if (!compAttrs.has(a)) companyOnly.set(a, (companyOnly.get(a) || 0) + 1);
      }
      for (const a of compAttrs) {
        if (!companyAttrs.has(a)) competitorOnly.set(a, (competitorOnly.get(a) || 0) + 1);
      }
    }
    const toRows = (m: Map<string, number>, nameOf: (id: string) => string) =>
      Array.from(m.entries())
        .map(([id, count]) => ({ id, name: nameOf(id), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    return {
      companyOnly: toRows(companyOnly, (id) => companyAttrNames.get(id) || id),
      competitorOnly: toRows(
        competitorOnly,
        (id) => competitorThemeAgg?.attrNames.get(id) || companyAttrNames.get(id) || id,
      ),
    };
  }, [companyAttrByResponse, companyAttrNames, competitorThemeAgg, coMentionResponses]);

  // ---------------------------------------------------------------------
  // Sections 5 + 6 need response texts — fetch for co-mention (order
  // position) and losing-prompt responses once per open.
  // ---------------------------------------------------------------------
  const losingResponses = useMemo(
    () => competitorResponses.filter((nr) => nr.promptType === "discovery" && !nr.mentioned),
    [competitorResponses],
  );

  useEffect(() => {
    if (!isOpen || !fetchResponseTexts) return;
    const wanted = [
      ...coMentionResponses.slice(0, ORDER_POSITION_TEXT_CAP),
      ...losingResponses.slice(0, 60),
    ]
      .map((nr) => nr.id)
      .filter((id) => !responseTexts[id] && !fetchedTexts[id]);
    if (wanted.length === 0) return;
    let cancelled = false;
    fetchResponseTexts(Array.from(new Set(wanted))).then((texts) => {
      if (!cancelled && texts) setFetchedTexts((prev) => ({ ...prev, ...texts }));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, competitorName, coMentionResponses.length, losingResponses.length]);

  const textOf = (nr: CompetitorNormalizedResponse): string =>
    responseTexts[nr.id] || fetchedTexts[nr.id] || nr.raw?.response_text || "";

  // Section 5 — order position across co-mention answers with known text.
  const orderPosition = useMemo(() => {
    let companyFirst = 0;
    let competitorFirst = 0;
    let considered = 0;
    for (const nr of coMentionResponses.slice(0, ORDER_POSITION_TEXT_CAP)) {
      const text = textOf(nr);
      if (!text) continue;
      const lower = text.toLowerCase();
      const companyIdx = lower.indexOf(companyName.toLowerCase());
      const competitorIdx = lower.indexOf(competitorName.toLowerCase());
      if (companyIdx === -1 || competitorIdx === -1 || companyIdx === competitorIdx) continue;
      considered += 1;
      if (companyIdx < competitorIdx) companyFirst += 1;
      else competitorFirst += 1;
    }
    return { companyFirst, competitorFirst, considered };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coMentionResponses, fetchedTexts, responseTexts, companyName, competitorName]);

  // Section 6 — losing prompts grouped by prompt.
  const losingPrompts = useMemo(() => {
    const byPrompt = new Map<string, {
      promptText: string;
      count: number;
      models: Set<string>;
      first: CompetitorNormalizedResponse;
    }>();
    for (const nr of losingResponses) {
      const key = nr.promptId || nr.promptText || nr.id;
      let agg = byPrompt.get(key);
      if (!agg) {
        agg = { promptText: nr.promptText || "(prompt unavailable)", count: 0, models: new Set(), first: nr };
        byPrompt.set(key, agg);
      }
      agg.count += 1;
      if (nr.model) agg.models.add(nr.model);
    }
    return Array.from(byPrompt.values()).sort((a, b) => b.count - a.count);
  }, [losingResponses]);

  // Excerpt around the competitor mention (slicing from the top routinely
  // cuts the mention out entirely).
  const excerptAround = (text: string, needle: string, chars = 320): string => {
    if (!text) return "";
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return text.slice(0, chars);
    const start = Math.max(0, idx - Math.floor(chars / 3));
    const end = Math.min(text.length, start + chars);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  };

  const highlightName = (snippet: string, name: string) => {
    const parts = snippet.split(new RegExp(`(${escapeRegExp(name)})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === name.toLowerCase()
        ? <mark key={i} className="bg-amber-100 text-gray-900 rounded px-0.5">{part}</mark>
        : <span key={i}>{part}</span>,
    );
  };

  // Section 7 — domains cited in this competitor's answers that never appear
  // in an answer mentioning the measured company.
  const competitorOnlyDomains = useMemo(() => {
    const domainsWithCompany = new Set<string>();
    for (const nr of analyzedResponses) {
      if (!nr.mentioned) continue;
      for (const d of nr.domains) domainsWithCompany.add(d);
    }
    const counts = new Map<string, number>();
    for (const nr of competitorResponses) {
      for (const d of nr.domains) {
        if (domainsWithCompany.has(d)) continue;
        counts.set(d, (counts.get(d) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [analyzedResponses, competitorResponses]);

  // ---------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------
  const SectionTitle = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
    <div className="flex items-center gap-1.5 mb-2.5">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{children}</h3>
      {hint && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-gray-300"><Info className="w-3.5 h-3.5" /></span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px]"><p className="text-xs">{hint}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );

  const HeadToHeadRow = ({
    label,
    company,
    competitor,
    format,
    noDataNote,
  }: {
    label: string;
    company: number | null;
    competitor: number | null;
    format: (v: number) => string;
    noDataNote: string;
  }) => {
    const max = Math.max(company ?? 0, competitor ?? 0, 1);
    const bar = (value: number | null, color: string, name: string) => (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] text-gray-500 w-24 truncate flex-shrink-0" title={name}>{name}</span>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          {value !== null && (
            <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
          )}
        </div>
        <span className="text-xs font-semibold text-gray-900 tabular-nums w-12 text-right flex-shrink-0">
          {value !== null ? format(value) : "—"}
        </span>
      </div>
    );
    return (
      <div className="py-2.5 border-b border-gray-100 last:border-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-700">{label}</span>
          {company !== null && competitor !== null ? (
            <span className={`text-[11px] font-semibold ${company >= competitor ? "text-green-600" : "text-red-600"}`}>
              {company >= competitor ? "you lead" : "they lead"} by {format(Math.abs(company - competitor))}
            </span>
          ) : (
            <span className="text-[11px] text-gray-400">{noDataNote}</span>
          )}
        </div>
        <div className="space-y-1.5">
          {bar(company, BRAND_COLOR, companyName)}
          {bar(competitor, COMPETITOR_COLOR, competitorName)}
        </div>
      </div>
    );
  };

  const ProfileRows = ({ rows }: { rows: Array<{ segment: string; n: number; coverage: number; deviation: number }> }) => (
    <div className="space-y-1">
      {rows.map((row) => {
        const max = Math.max(...rows.map((r) => r.coverage), overallCoverage, 1);
        return (
          <div key={row.segment} className="flex items-center gap-2 py-1 min-w-0">
            <span className="text-xs text-gray-700 w-32 truncate flex-shrink-0" title={row.segment}>{row.segment}</span>
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full"
                style={{ width: `${(row.coverage / max) * 100}%`, backgroundColor: COMPETITOR_COLOR }}
              />
              {/* Their all-scope average as a reference tick */}
              <div
                className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-gray-400/70 rounded"
                style={{ left: `${Math.min(99, (overallCoverage / max) * 100)}%` }}
                title={`Average across all answers: ${overallCoverage.toFixed(1)}%`}
              />
            </div>
            <span className="text-xs font-semibold text-gray-900 tabular-nums w-11 text-right flex-shrink-0">
              {row.coverage.toFixed(1)}%
            </span>
            <span
              className={`text-[11px] font-semibold tabular-nums w-14 text-right flex-shrink-0 ${
                Math.round(row.deviation) === 0 ? "text-gray-400" : row.deviation > 0 ? "text-red-600" : "text-green-600"
              }`}
              title={`${row.n} answers in this segment`}
            >
              {Math.round(row.deviation) === 0 ? "avg" : `${row.deviation > 0 ? "+" : ""}${Math.round(row.deviation)} pp`}
            </span>
          </div>
        );
      })}
    </div>
  );

  const AttrChips = ({ rows, tone }: { rows: Array<{ id: string; name: string; count: number }>; tone: "company" | "competitor" }) => (
    rows.length === 0 ? (
      <p className="text-xs text-gray-400">None found in shared answers.</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {rows.map((a) => {
          const Icon = getAttributeIconByName(a.name);
          return (
            <span
              key={a.id}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                tone === "company" ? "bg-[#0DBCBA]/10 text-[#0B8583]" : "bg-slate-100 text-slate-600"
              }`}
            >
              <Icon className="w-3 h-3 flex-shrink-0" />
              {a.name}
              <span className="opacity-60">×{a.count}</span>
            </span>
          );
        })}
      </div>
    )
  );

  const answersCount = competitorAgg?.count ?? 0;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col gap-0 [&>button]:hidden w-full sm:max-w-2xl inset-y-0 h-full rounded-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold min-w-0">
            <img
              src={getCompetitorFavicon(competitorName)}
              alt=""
              className="w-5 h-5 rounded flex-shrink-0"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <span className="truncate">{competitorName}</span>
            <Badge variant="secondary" className="flex-shrink-0">
              {answersCount} answer{answersCount === 1 ? "" : "s"}
            </Badge>
          </SheetTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 flex-shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* 1 — Head-to-head */}
          <section>
            <SectionTitle hint={`Visibility: share of the analyzed answers mentioning each of you. Sentiment: positive share of opinionated themes (neutrals excluded). Freshness: average recency of the sources cited where each of you appears (0–100).`}>
              Head-to-head vs {companyName}
            </SectionTitle>
            <div className="rounded-lg border border-gray-100 px-3">
              <HeadToHeadRow
                label="Visibility"
                company={scorecard.visibility.company}
                competitor={scorecard.visibility.competitor}
                format={(v) => `${v.toFixed(1)}%`}
                noDataNote=""
              />
              <HeadToHeadRow
                label="Sentiment"
                company={scorecard.sentiment.company}
                competitor={scorecard.sentiment.competitor}
                format={(v) => `${Math.round(v)}%`}
                noDataNote={
                  scorecard.sentiment.competitor === null
                    ? hasCompetitorThemeData
                      ? "no opinionated themes for them yet"
                      : "accrues with newly collected answers"
                    : "no signal"
                }
              />
              <HeadToHeadRow
                label="Source freshness"
                company={scorecard.freshness.company}
                competitor={scorecard.freshness.competitor}
                format={(v) => `${Math.round(v)}`}
                noDataNote="no recency data for the cited sources"
              />
            </div>
          </section>

          {/* 2 — Function profile */}
          {functionProfile.length > 1 && (
            <section>
              <SectionTitle hint={`Where ${competitorName} concentrates: their coverage inside each job function vs their all-function average (the tick mark). Red = overweight there. Functions with fewer than ${PROFILE_MIN_ANSWERS} answers are hidden.`}>
                Function profile
              </SectionTitle>
              <ProfileRows rows={functionProfile} />
            </section>
          )}

          {/* 3 — Market profile */}
          {marketProfile.length > 1 && (
            <section>
              <SectionTitle hint={`Same view across markets: their coverage in each market vs their overall average (the tick mark). Red = overweight there.`}>
                Market profile
              </SectionTitle>
              <ProfileRows rows={marketProfile} />
            </section>
          )}

          {/* 4 — Unique attributes */}
          <section>
            <SectionTitle hint={`Within answers naming BOTH of you: attributes the AI credits to one and not the other in the same answer.`}>
              Unique attributes
            </SectionTitle>
            {coMentionResponses.length === 0 ? (
              <p className="text-xs text-gray-400">No shared answers with {companyName} in this period.</p>
            ) : uniqueAttributes === null ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-6 rounded bg-gray-100 animate-pulse" />
                <div className="h-6 rounded bg-gray-100 animate-pulse" />
              </div>
            ) : !hasCompetitorThemeData ? (
              <p className="text-xs text-gray-400">
                Competitor attribute data accrues as new answers are collected and
                themed — this section fills in from the next collection run.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-medium text-gray-500 mb-1.5">Yours, not theirs</p>
                  <AttrChips rows={uniqueAttributes.companyOnly} tone="company" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-gray-500 mb-1.5">Theirs, not yours</p>
                  <AttrChips rows={uniqueAttributes.competitorOnly} tone="competitor" />
                </div>
              </div>
            )}
          </section>

          {/* 5 — Order position */}
          <section>
            <SectionTitle hint={`Across answers naming both of you: which name appears first in the answer text. Being named first correlates with being the anchor of the comparison.`}>
              Order position
            </SectionTitle>
            {orderPosition.considered === 0 ? (
              <p className="text-xs text-gray-400">
                {coMentionResponses.length === 0
                  ? `No shared answers with ${companyName} in this period.`
                  : "Loading answer texts…"}
              </p>
            ) : (
              <div>
                <div className="flex h-2 gap-[2px] rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(orderPosition.companyFirst / orderPosition.considered) * 100}%`,
                      backgroundColor: BRAND_COLOR,
                    }}
                  />
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(orderPosition.competitorFirst / orderPosition.considered) * 100}%`,
                      backgroundColor: COMPETITOR_COLOR,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>
                    <span className="font-semibold text-gray-900">
                      {Math.round((orderPosition.companyFirst / orderPosition.considered) * 100)}%
                    </span>{" "}
                    {companyName} named first
                  </span>
                  <span>
                    {competitorName} first{" "}
                    <span className="font-semibold text-gray-900">
                      {Math.round((orderPosition.competitorFirst / orderPosition.considered) * 100)}%
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Across {orderPosition.considered} shared answers.</p>
              </div>
            )}
          </section>

          {/* 6 — Losing prompts */}
          <section>
            <SectionTitle hint={`Discovery prompts (that don't name you) where ${competitorName} appears in the answer and ${companyName} doesn't — the questions they're winning outright.`}>
              Losing prompts
            </SectionTitle>
            {losingPrompts.length === 0 ? (
              <p className="text-xs text-gray-400">
                None — {companyName} appears in every discovery answer that mentions {competitorName}.
              </p>
            ) : (
              <div className="space-y-2">
                {losingPrompts.slice(0, LOSING_PROMPT_LIMIT).map((prompt, idx) => {
                  const expanded = expandedPromptIdx === idx;
                  const text = textOf(prompt.first);
                  return (
                    <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50/50">
                      <button
                        onClick={() => setExpandedPromptIdx(expanded ? null : idx)}
                        className="w-full flex items-start gap-2 px-3 py-2 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-800 leading-snug">{prompt.promptText}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-gray-400">
                              {prompt.count} answer{prompt.count === 1 ? "" : "s"} without you
                            </span>
                            <span className="flex items-center gap-0.5">
                              {Array.from(prompt.models).slice(0, 4).map((m) => (
                                <LLMLogo key={m} modelName={getLLMDisplayName(m)} size="sm" showFallback={false} />
                              ))}
                            </span>
                          </div>
                        </div>
                        {expanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                          : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />}
                      </button>
                      {expanded && (
                        <div className="px-3 pb-2.5">
                          {text ? (
                            <p className="text-xs text-gray-600 leading-relaxed bg-white rounded-md border border-gray-100 p-2.5">
                              {highlightName(excerptAround(text, competitorName), competitorName)}
                            </p>
                          ) : (
                            <p className="text-[11px] text-gray-400">Loading answer excerpt…</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {losingPrompts.length > LOSING_PROMPT_LIMIT && (
                  <p className="text-[11px] text-gray-400">
                    +{losingPrompts.length - LOSING_PROMPT_LIMIT} more prompts.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 7 — Competitor-only cited domains */}
          <section>
            <SectionTitle hint={`Domains cited in answers mentioning ${competitorName} that are never cited in any answer mentioning ${companyName} — sources fueling their visibility that don't carry yours.`}>
              Sources that cite them, never you
            </SectionTitle>
            {competitorOnlyDomains.length === 0 ? (
              <p className="text-xs text-gray-400">
                None — every source citing {competitorName}'s answers also shows up where you're mentioned.
              </p>
            ) : (
              <>
                <div className="divide-y divide-gray-50">
                  {(showAllDomains ? competitorOnlyDomains : competitorOnlyDomains.slice(0, DOMAIN_PREVIEW_LIMIT)).map(({ domain, count }) => (
                    <button
                      key={domain}
                      onClick={() => onOpenSourcesForDomain?.(domain)}
                      className="w-full flex items-center gap-2 py-1.5 group text-left"
                      title={`Open ${domain} in Sources`}
                    >
                      <img
                        src={getFavicon(domain)}
                        alt=""
                        className="w-4 h-4 rounded flex-shrink-0"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                      <span className="text-xs text-gray-800 truncate group-hover:text-gray-900">{domain}</span>
                      <span className="ml-auto text-[11px] text-gray-400 flex-shrink-0">
                        {count} answer{count === 1 ? "" : "s"}
                      </span>
                      {onOpenSourcesForDomain && (
                        <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
                {competitorOnlyDomains.length > DOMAIN_PREVIEW_LIMIT && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllDomains((v) => !v)}
                    className="mt-1 h-7 px-2 text-xs text-gray-500"
                  >
                    {showAllDomains ? "Show fewer" : `Show all ${competitorOnlyDomains.length}`}
                  </Button>
                )}
              </>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
};
