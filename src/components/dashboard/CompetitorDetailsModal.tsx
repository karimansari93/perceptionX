import { useEffect, useMemo, useState, useCallback } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RateDonut } from "@/components/ui/rate-donut";
import {
  X, ExternalLink, ChevronDown, ChevronUp, Info, Sparkles, Loader2, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCompetitorFavicon, getFavicon } from "@/utils/citationUtils";
import { getAttributeIconByName } from "@/config/attributeIcons";
import { getLLMDisplayName } from "@/config/llmLogos";
import { sentimentRatioV2 } from "@/lib/sentimentV2";
import { escapeRegExp } from "@/utils/competitorDetection";
import LLMLogo from "@/components/LLMLogo";
import type { CompetitorNormalizedResponse } from "./CompetitorsTab";

// Mirrors SourceDetailsModal: identity header + stat strip, underline tabs,
// on-demand AI summary above the tab content, floating Ask AI button.
//
// Tab layout is deliberately answer-first (the client's questions, in order):
//   1. Where they win — sources that cite them and never you, and the
//      discovery prompts they take outright
//   2. Attributes — what the AI credits each of you with that the other lacks
//   3. Head-to-head — scorecard, naming order, function/market concentration

const BRAND_COLOR = "#0DBCBA";
const COMPETITOR_COLOR = "#64748B";
const PROFILE_MIN_ANSWERS = 3;
const LOSING_PROMPT_LIMIT = 8;
const DOMAIN_PREVIEW_LIMIT = 10;
const ORDER_POSITION_TEXT_CAP = 200;
const SUMMARY_SAMPLE_CAP = 20;
const SUMMARY_EXCERPT_CHARS = 380;

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
  /** True while the raw response stream is still arriving. On cube-backed
   *  scopes the table can open this modal before the rows that feed its
   *  response lists exist — show a loading panel instead of empty tabs. */
  responsesLoading?: boolean;
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
  responsesLoading = false,
}: CompetitorDetailsModalProps) => {
  const [activeTab, setActiveTab] = useState("wins");
  const [expandedPromptIdx, setExpandedPromptIdx] = useState<number | null>(null);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [fetchedTexts, setFetchedTexts] = useState<Record<string, string>>({});

  // AI summary state (same three-state machine as the Sources modal).
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(-1);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);

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

  const losingResponses = useMemo(
    () => competitorResponses.filter((nr) => nr.promptType === "discovery" && !nr.mentioned),
    [competitorResponses],
  );

  // ---------------------------------------------------------------------
  // Stat strip numbers
  // ---------------------------------------------------------------------
  const stats = useMemo(() => {
    const coverage = totals.total > 0 && competitorAgg ? competitorAgg.count / totals.total : 0;
    const coMentionRate = competitorAgg && competitorAgg.count > 0
      ? competitorAgg.coMention / competitorAgg.count
      : 0;
    const markets = new Set<string>();
    const models = new Set<string>();
    for (const nr of competitorResponses) {
      if (nr.location) markets.add(nr.location);
      if (nr.model) models.add(getLLMDisplayName(nr.model));
    }
    const allModels = new Set<string>();
    for (const nr of analyzedResponses) {
      if (nr.model) allModels.add(getLLMDisplayName(nr.model));
    }
    return { coverage, coMentionRate, marketCount: markets.size, modelCount: models.size, totalModelCount: allModels.size };
  }, [competitorResponses, analyzedResponses, totals, competitorAgg]);

  // ---------------------------------------------------------------------
  // Tab 1 — where they win
  // ---------------------------------------------------------------------
  // Domains cited in answers mentioning this competitor that are NEVER cited
  // in any answer mentioning the measured company.
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

  // ---------------------------------------------------------------------
  // Tab 2 — unique attributes
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
        .slice(0, 6);
    return {
      companyOnly: toRows(companyOnly, (id) => companyAttrNames.get(id) || id),
      competitorOnly: toRows(
        competitorOnly,
        (id) => competitorThemeAgg?.attrNames.get(id) || companyAttrNames.get(id) || id,
      ),
    };
  }, [companyAttrByResponse, companyAttrNames, competitorThemeAgg, coMentionResponses]);

  // ---------------------------------------------------------------------
  // Tab 3 — head-to-head
  // ---------------------------------------------------------------------
  const scorecard = useMemo(() => {
    const companyVisibility = totals.total > 0 ? (totals.companyMentioned / totals.total) * 100 : 0;
    const competitorVisibility = totals.total > 0 && competitorAgg
      ? (competitorAgg.count / totals.total) * 100
      : 0;

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
    return {
      visibility: { company: companyVisibility, competitor: competitorVisibility },
      sentiment: { company: companySentiment, competitor: competitorSentiment },
      freshness: {
        company: avgFreshness(analyzedResponses.filter((nr) => nr.mentioned)),
        competitor: avgFreshness(competitorResponses),
      },
    };
  }, [analyzedResponses, competitorResponses, totals, competitorAgg, competitorThemeAgg, companySentimentById, domainRecencyAvg]);

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
  // Response texts (order position + losing-prompt excerpts + AI summary)
  // ---------------------------------------------------------------------
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

  const textOf = useCallback((nr: CompetitorNormalizedResponse): string =>
    responseTexts[nr.id] || fetchedTexts[nr.id] || nr.raw?.response_text || "",
  [responseTexts, fetchedTexts]);

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
  }, [coMentionResponses, textOf, companyName, competitorName]);

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

  // ---------------------------------------------------------------------
  // AI summary — on demand via the floating Ask AI button (Sources pattern),
  // with the three-section framing the old competitor sheet had.
  // ---------------------------------------------------------------------
  const fetchSummary = useCallback(async () => {
    if (!competitorAgg || competitorResponses.length === 0) {
      setSummaryError("No answers mentioning this competitor in the current scope.");
      return;
    }
    setSummary("");
    setSummaryError(null);
    setLoadingSummary(true);
    setThinkingStep(0);

    const totalCount = competitorAgg.count;
    const withoutCompanyCount = totalCount - competitorAgg.coMention;

    // Sample weighted toward answers where the company is ABSENT — that's
    // where the competitor is winning ground.
    const withoutCompany = competitorResponses.filter((nr) => !nr.mentioned);
    const withCompany = competitorResponses.filter((nr) => nr.mentioned);
    const gapTarget = Math.min(withoutCompany.length, Math.ceil(SUMMARY_SAMPLE_CAP / 2));
    const sample = [
      ...withoutCompany.slice(0, gapTarget),
      ...withCompany.slice(0, SUMMARY_SAMPLE_CAP - gapTarget),
    ];

    const steps = [
      totalCount > SUMMARY_SAMPLE_CAP
        ? `Sampling ${sample.length} of ${totalCount} answers…`
        : `Reading ${sample.length} answers…`,
      `Comparing visibility vs ${companyName}…`,
      `Ranking the sources carrying them…`,
      `Writing the summary…`,
    ];
    setThinkingSteps(steps);
    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < steps.length; i += 1) {
      stepTimers.push(setTimeout(() => setThinkingStep(i), i * 1500));
    }

    try {
      // Texts for the sample (many are usually cached already).
      let texts: Record<string, string> = { ...responseTexts, ...fetchedTexts };
      const missing = sample.filter((nr) => !texts[nr.id] && !nr.raw?.response_text).map((nr) => nr.id);
      if (missing.length > 0 && fetchResponseTexts) {
        const fetched = await fetchResponseTexts(missing);
        if (fetched) texts = { ...texts, ...fetched };
      }

      const domainCounts = new Map<string, number>();
      const locationCounts = new Map<string, number>();
      const functionCounts = new Map<string, number>();
      for (const nr of competitorResponses) {
        for (const d of nr.domains) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
        if (nr.location) locationCounts.set(nr.location, (locationCounts.get(nr.location) || 0) + 1);
        if (nr.jobFunction) functionCounts.set(nr.jobFunction, (functionCounts.get(nr.jobFunction) || 0) + 1);
      }
      const topLine = (m: Map<string, number>, n: number) =>
        Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n)
          .map(([k, v]) => `${k} (${v})`).join(", ");
      const exclusiveLine = competitorOnlyDomains.slice(0, 6)
        .map((d) => `${d.domain} (${d.count})`).join(", ");

      const prompt = `You are an employer brand analyst. Analyze how ${competitorName} shows up in AI answers about the talent market, and what that means for ${companyName}.

Hard numbers, computed over ALL ${totalCount} AI answers that mention ${competitorName}:
- ${withoutCompanyCount} of ${totalCount} answers mention ${competitorName} WITHOUT mentioning ${companyName} — this is where ${competitorName} is winning visibility.
- ${competitorAgg.coMention} answers mention both companies.
- Top sources carrying ${competitorName}'s visibility (answer counts): ${topLine(domainCounts, 6) || "n/a"}
- Sources that cite ${competitorName} and NEVER cite ${companyName}: ${exclusiveLine || "none"}
- Markets (answer counts): ${topLine(locationCounts, 4) || "unspecified"}
- Job functions (answer counts): ${topLine(functionCounts, 4) || "unspecified"}

Excerpts from answers mentioning ${competitorName} — each tagged with whether ${companyName} also appeared:
${sample.map((nr) => {
  const tag = nr.mentioned ? "[both mentioned]" : `[${companyName} ABSENT]`;
  return `${tag} ${excerptAround(textOf(nr) || (texts[nr.id] ?? ""), competitorName, SUMMARY_EXCERPT_CHARS)}`;
}).join("\n---\n")}

Write a short, actionable analysis with three short sections. Each section uses a markdown bold header on its own line, followed by ONE or TWO short sentences. Total output is short — keep it tight. Ground every claim in the hard numbers or excerpts, naming specific markets, functions, or sources.

**Where ${competitorName} is visible**
Which sources, markets, and roles ${competitorName} shows up in — lean on the hard numbers.

**Where they're winning vs ${companyName}**
What ${competitorName} is recognized for in the answers where ${companyName} is absent — the themes or claims earning them that visibility.

**Your move**
One concrete, actionable recommendation for ${companyName} in response — targeted at a specific market, function, or source.

Be direct, specific, professional. No hedging, no preamble, no summary paragraph. Do not open with "${competitorName} is...". **Do NOT include a top-level title or heading** (no "# Title", no "## Heading"). Only the three bold section headers exactly as specified. NEVER claim the dataset lacks ${competitorName} data — if the excerpts are thin, lean on the hard numbers instead.`;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSummaryError("Authentication required");
        return;
      }
      const res = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          prompt,
          enableWebSearch: false,
          model: "claude-haiku-4-5",
          maxTokens: 900,
        }),
      });
      const data = await res.json();
      if (data.response) {
        setSummary(data.response.trim());
      } else {
        const isRateLimit = /rate limit|429/i.test(data.error || "");
        setSummaryError(
          isRateLimit
            ? "We're a bit overloaded right now — give it a moment."
            : "Couldn't generate the summary. Try again?",
        );
      }
    } catch {
      setSummaryError("Couldn't generate the summary. Try again?");
    } finally {
      stepTimers.forEach(clearTimeout);
      setLoadingSummary(false);
      setThinkingStep(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitorAgg, competitorResponses, competitorOnlyDomains, companyName, competitorName, responseTexts, fetchedTexts, fetchResponseTexts, textOf]);

  // Reset summary when the modal closes or the competitor changes.
  useEffect(() => {
    setSummary("");
    setSummaryError(null);
    setLoadingSummary(false);
    setThinkingStep(-1);
    setActiveTab("wins");
    setExpandedPromptIdx(null);
    setShowAllDomains(false);
  }, [isOpen, competitorName]);

  // Bold-header-aware paragraph renderer for the summary text.
  const renderSummaryText = (text: string) =>
    text.split("\n\n").filter(Boolean).map((para, i) => {
      const trimmed = para.trim();
      if (/^#{1,6}\s/.test(trimmed)) return null;
      const headerOnly = trimmed.match(/^\*\*([^*]+)\*\*$/);
      if (headerOnly) {
        return (
          <h4 key={i} className="text-sm font-semibold text-gray-900 mt-3 first:mt-0 mb-1">
            {headerOnly[1]}
          </h4>
        );
      }
      const parts = trimmed.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
      return (
        <p key={i} className="mb-2.5 last:mb-0">
          {parts.map((p, j) => {
            const b = p.match(/^\*\*([^*]+)\*\*$/);
            if (b) return <strong key={j} className="font-semibold text-gray-900">{b[1]}</strong>;
            const em = p.match(/^\*([^*\n]+)\*$/);
            if (em) return <em key={j} className="not-italic font-medium text-gray-900">{em[1]}</em>;
            return <span key={j}>{p}</span>;
          })}
        </p>
      );
    });

  // ---------------------------------------------------------------------
  // Small render helpers
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
  const tabTriggerCls = "relative rounded-none border-b-2 border-transparent bg-transparent px-0 py-3 text-sm font-medium text-gray-500 shadow-none transition-colors hover:text-[#13274F] data-[state=active]:border-[#13274F] data-[state=active]:text-[#13274F] data-[state=active]:bg-transparent data-[state=active]:shadow-none";

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col gap-0 [&>button]:hidden">
        {/* Header */}
        <div className="border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl border border-gray-100 bg-white shadow-sm grid place-items-center shrink-0 overflow-hidden">
                <img
                  src={getCompetitorFavicon(competitorName)}
                  alt=""
                  className="w-6 h-6 object-contain"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              </div>
              <div className="min-w-0">
                <SheetTitle className="font-headline text-lg font-semibold text-[#13274F] leading-tight truncate">
                  {competitorName}
                </SheetTitle>
                <p className="text-xs text-gray-400">
                  Mentioned in {answersCount.toLocaleString()} AI answer{answersCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border-t border-gray-100">
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Coverage</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <RateDonut rate={stats.coverage} size={18} />
                <span className="text-sm font-semibold text-[#13274F]">{(stats.coverage * 100).toFixed(1)}%</span>
              </div>
            </div>
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Appear with you</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <RateDonut rate={stats.coMentionRate} size={18} />
                <span className="text-sm font-semibold text-[#13274F]">{Math.round(stats.coMentionRate * 100)}%</span>
              </div>
            </div>
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Markets</p>
              <p className="mt-0.5 text-sm font-semibold text-[#13274F]">{stats.marketCount}</p>
            </div>
            <div className="px-6 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Models</p>
              <p className="mt-0.5 text-sm font-semibold text-[#13274F]">{stats.modelCount} of {stats.totalModelCount}</p>
            </div>
          </div>
        </div>

        {responsesLoading && (competitorAgg?.responseIds.length ?? 0) === 0 ? (
          <div className="flex-1 flex items-center justify-center py-16 text-gray-500">
            <div className="text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-gray-400" />
              <p className="text-sm">Loading this competitor's responses…</p>
            </div>
          </div>
        ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start gap-6 rounded-none border-b border-gray-200 bg-transparent p-0 px-6 h-auto shrink-0">
            <TabsTrigger value="wins" className={tabTriggerCls}>
              Where they win
              {(competitorOnlyDomains.length > 0 || losingPrompts.length > 0) && (
                <span className="ml-1.5 rounded-full bg-[#DB5E89]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#DB5E89]">
                  {competitorOnlyDomains.length + losingPrompts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="attributes" className={tabTriggerCls}>
              Attributes
            </TabsTrigger>
            <TabsTrigger value="headtohead" className={tabTriggerCls}>
              Head-to-head
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <div className="px-6 pt-4 empty:hidden">
              {/* AI Summary — on demand */}
              {summary ? (
                <Card className="border-[#0DBCBA]/30 bg-[#0DBCBA]/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                        AI Summary
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchSummary}
                        disabled={loadingSummary}
                        className="text-xs text-gray-400 hover:text-gray-600 h-auto py-1"
                      >
                        {loadingSummary ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        Regenerate
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-gray-800 text-sm leading-relaxed">{renderSummaryText(summary)}</div>
                  </CardContent>
                </Card>
              ) : loadingSummary ? (
                <Card className="border-[#0DBCBA]/30 bg-gradient-to-br from-[#0DBCBA]/5 to-[#0DBCBA]/10 overflow-hidden">
                  <CardContent className="py-5 px-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="relative">
                        <Sparkles className="w-4 h-4 text-[#0DBCBA]" />
                        <div className="absolute inset-0 animate-ping"><Sparkles className="w-4 h-4 text-[#0DBCBA] opacity-30" /></div>
                      </div>
                      <span className="text-sm font-medium text-[#0A8B89]">Analyzing...</span>
                    </div>
                    <div className="space-y-0.5">
                      {thinkingSteps.map((step, i) => {
                        const isActive = i === thinkingStep;
                        const isComplete = i < thinkingStep;
                        const isPending = i > thinkingStep;
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-500 ${isActive ? "bg-[#0DBCBA]/15" : ""}`}
                            style={{ opacity: isPending ? 0.3 : 1, transform: isPending ? "translateX(4px)" : "translateX(0)", transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)" }}
                          >
                            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                              {isComplete ? <CheckCircle2 className="w-3.5 h-3.5 text-[#0DBCBA]" /> : isActive ? <Loader2 className="w-3.5 h-3.5 text-[#0DBCBA] animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />}
                            </div>
                            <span className={`text-xs transition-colors duration-300 ${isActive ? "text-[#0A8B89] font-medium" : isComplete ? "text-[#0DBCBA]" : "text-gray-400"}`}>{step}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 h-1 bg-[#0DBCBA]/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#0DBCBA] to-[#0A8B89] rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${thinkingSteps.length > 0 ? ((thinkingStep + 1) / thinkingSteps.length) * 100 : 0}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : summaryError ? (
                <Card className="border-red-100 bg-red-50/30">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <span className="text-red-600 text-sm">{summaryError}</span>
                      <Button variant="ghost" size="sm" onClick={fetchSummary} className="text-xs">Retry</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {/* ------------------------------------------ Tab 1: where they win */}
            <TabsContent value="wins" className="px-6 py-4 mt-0 focus-visible:outline-none space-y-6">
              <section>
                <SectionTitle hint={`Domains cited in answers mentioning ${competitorName} that are never cited in any answer mentioning ${companyName} — the sources fueling their visibility that don't carry yours. Click one to open it in Sources.`}>
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

              <section>
                <SectionTitle hint={`Discovery prompts (that don't name you) where ${competitorName} appears in the answer and ${companyName} doesn't — the questions they're winning outright.`}>
                  Prompts they win
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
            </TabsContent>

            {/* ------------------------------------------ Tab 2: attributes */}
            <TabsContent value="attributes" className="px-6 py-4 mt-0 focus-visible:outline-none">
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
                  <div className="space-y-4">
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
            </TabsContent>

            {/* ------------------------------------------ Tab 3: head-to-head */}
            <TabsContent value="headtohead" className="px-6 py-4 mt-0 focus-visible:outline-none space-y-6">
              <section>
                <SectionTitle hint={`Visibility: share of the analyzed answers mentioning each of you. Sentiment: positive share of opinionated themes (neutrals excluded). Freshness: average recency of the sources cited where each of you appears (0–100).`}>
                  Scorecard
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

              <section>
                <SectionTitle hint={`Across answers naming both of you: which name appears first in the answer text. Being named first correlates with being the anchor of the comparison.`}>
                  Who's named first
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

              {functionProfile.length > 1 && (
                <section>
                  <SectionTitle hint={`Where ${competitorName} concentrates: their coverage inside each job function vs their all-function average (the tick mark). Red = overweight there. Functions with fewer than ${PROFILE_MIN_ANSWERS} answers are hidden.`}>
                    Function profile
                  </SectionTitle>
                  <ProfileRows rows={functionProfile} />
                </section>
              )}

              {marketProfile.length > 1 && (
                <section>
                  <SectionTitle hint={`Same view across markets: their coverage in each market vs their overall average (the tick mark). Red = overweight there.`}>
                    Market profile
                  </SectionTitle>
                  <ProfileRows rows={marketProfile} />
                </section>
              )}
            </TabsContent>
          </div>
        </Tabs>
        )}

        {/* Floating Ask AI button — bottom right of panel */}
        {!summary && !loadingSummary && !summaryError && (
          <div className="absolute bottom-6 right-6 z-10 animate-slideUpGlow rounded-full">
            <button
              onClick={fetchSummary}
              className="h-12 rounded-full bg-[#13274F] text-white shadow-lg hover:bg-[#1a3468] transition-all hover:scale-105 flex items-center justify-center gap-2 px-5"
            >
              <img alt="PerceptionX" className="h-5 w-5 object-contain shrink-0 brightness-0 invert" src="/logos/perceptionx-small.png" />
              <span className="text-sm font-medium whitespace-nowrap">Ask AI</span>
              <span className="text-[10px] font-semibold bg-[#DB5E89] text-white px-1.5 py-0.5 rounded-full leading-none">BETA</span>
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
