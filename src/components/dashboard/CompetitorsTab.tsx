import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users, TrendingUp, TrendingDown, Info, ChartLine, BarChartHorizontal,
  Tags, Bot, SmilePlus, Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useTabSearchSeed, useSeedTabSearch } from "@/contexts/TabSearchSeedContext";
import { useEntityCanonicalizer } from "@/hooks/useEntityCanonicalizer";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { enhanceCitations, getCompetitorFavicon } from "@/utils/citationUtils";
import { getLLMDisplayName } from "@/config/llmLogos";
import { getAttributeIconByName } from "@/config/attributeIcons";
import { sentimentRatioV2 } from "@/lib/sentimentV2";
import {
  parseDetectedCompetitors,
  buildVariantCollapseMap,
} from "@/utils/competitorDetection";
import { normalizeEntityName } from "@/utils/competitorUtils";
import LLMLogo from "@/components/LLMLogo";
import { ScrollablePills } from "./ScrollablePills";
import { SearchInput } from "./SearchInput";
import { FilterDropdown } from "./FilterDropdown";
import { CompetitorDetailsModal } from "./CompetitorDetailsModal";

// ---------------------------------------------------------------------------
// Shared constants (mirroring the Sources tab patterns)
// ---------------------------------------------------------------------------
const BRAND_COLOR = "#0DBCBA";
const COMPETITOR_BAR_COLOR = "#94A3B8";
const CHART_COLORS = ["#0DBCBA", "#5B7FD9", "#DB5E89", "#E8A33D", "#8B5CF6"];
const TREND_COMPETITOR_LIMIT = 4; // + the measured company = 5 series
const CARD1_ROW_LIMIT = 10;
const EOC_ROW_LIMIT = 12;
const INITIAL_TABLE_ROWS = 15;
const TABLE_ROWS_STEP = 50;
const OWNS_ATTRIBUTE_CHIPS = 2;

export type CompetitorSet = "eoc" | "direct" | "emergent";

const SET_LABELS: Record<CompetitorSet, string> = {
  eoc: "Employer of choice",
  direct: "Direct",
  emergent: "Emergent",
};

type TrendGranularity = "week" | "month";

const startOfWeekTs = (ts: number): number => {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfMonthTs = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

const normalizeDomain = (domain: string): string =>
  (domain || "").trim().toLowerCase().replace(/^www\./, "");

// Placeholder guard for post-canonicalization output (the parse util owns the
// canonical exclusion list; alias mapping can reintroduce a junk display name).
const isPlaceholder = (name: string): boolean =>
  ["none", "n/a", "na", "null", "undefined"].includes(name.trim().toLowerCase());

// ---------------------------------------------------------------------------
// Normalized response shape — one parse per response, shared by every card,
// the table and the detail modal (the Sources tab pattern).
// ---------------------------------------------------------------------------
export type CompetitorNormalizedResponse = {
  raw: any;
  id: string;
  mentioned: boolean;
  model: string;
  jobFunction: string | null;
  location: string | null;
  promptType: string | undefined;
  promptText: string | undefined;
  promptId: string | undefined;
  testedAt: number | null;
  /** Final competitor names: canonicalized, self/noise-excluded, variant-collapsed. */
  competitors: string[];
  /** Normalized website domains cited by this response. */
  domains: string[];
};

/** Per-competitor rollup used by the cards and the table. */
type CompetitorAgg = {
  name: string;
  count: number;            // responses mentioning the competitor
  coMention: number;        // …of which also mention the measured company
  discoveryCount: number;   // …on discovery prompts
  competitiveCount: number; // …on competitive (comparison) prompts
  models: Set<string>;      // LLM display names
  responseIds: string[];
};

interface CompetitorsTabProps {
  responses: any[];
  companyName: string;
  currentCompanyId?: string;
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  previousPeriodResponses?: any[];
  // True while the raw response stream for the current company is still
  // arriving (it loads AFTER first paint). Gates the empty state: skeleton
  // rows, never "No competitors found yet", until the stream is final.
  responsesLoading?: boolean;
  // Global job-function filter, shared across all dashboard tabs and owned by
  // the parent Dashboard so a selection persists when switching tabs.
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
  // Per-response sentiment rollup rows (company_response_sentiment_mv) — the
  // measured company's side of the head-to-head sentiment comparison.
  responseSentimentRows?: any[];
  // url_recency_cache rows {url, domain, recency_score 0-100} — the
  // freshness/relevance comparison in the head-to-head scorecard.
  recencyData?: any[];
  // Switches the dashboard to the Sources tab (competitor-only cited domains
  // link through to it; the seed is set here via useSeedTabSearch).
  onNavigateToSources?: () => void;
}

export const CompetitorsTab = memo(({
  responses,
  companyName,
  currentCompanyId,
  responseTexts = {},
  fetchResponseTexts,
  previousPeriodResponses = [],
  responsesLoading = false,
  selectedJobFunction = "all",
  onJobFunctionChange,
  responseSentimentRows = [],
  recencyData = [],
  onNavigateToSources,
}: CompetitorsTabProps) => {
  const { canonicalize, aliasMap, aliasMapLoaded } = useEntityCanonicalizer();
  const { currentCompany } = useCompany();
  const seedTabSearch = useSeedTabSearch();

  // "Competitor-only cited domains" rows in the modal land on the Sources tab
  // with that domain's detail modal pre-opened (the palette-seed mechanism).
  const handleOpenSourcesForDomain = useCallback((domain: string) => {
    seedTabSearch("sources", domain);
    onNavigateToSources?.();
  }, [seedTabSearch, onNavigateToSources]);

  // -------------------------------------------------------------------------
  // UI state
  // -------------------------------------------------------------------------
  const [chartType, setChartType] = usePersistedState<"bar" | "line">("competitorsTab.chartType", "bar");
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [modalCompetitor, setModalCompetitor] = usePersistedState<string | null>("competitorsTab.modalCompetitor", null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>("competitorsTab.isModalOpen", false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSets, setFilterSets] = useState<string[]>([]);
  const [filterAttributes, setFilterAttributes] = useState<string[]>([]);
  const [filterModels, setFilterModels] = useState<string[]>([]);
  const [filterSentiments, setFilterSentiments] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<"name" | "attributes" | "models" | "sentiment" | "coverage">("coverage");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleRows, setVisibleRows] = useState(INITIAL_TABLE_ROWS);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Let the global command palette pre-fill this tab's search.
  useTabSearchSeed("competitors", setSearchQuery);

  const selectedJobFunctionFilter = selectedJobFunction;
  const setSelectedJobFunctionFilter = onJobFunctionChange ?? (() => {});

  // -------------------------------------------------------------------------
  // Competitor ↔ attribute ↔ sentiment triples (competitor_themes). Loaded
  // once per company; rows only exist for responses themed after the
  // extraction pass started emitting them, so every consumer must degrade to
  // "—" when a competitor has no rows yet.
  // -------------------------------------------------------------------------
  const [competitorThemeRows, setCompetitorThemeRows] = useState<any[]>([]);
  useEffect(() => {
    if (!currentCompanyId) {
      setCompetitorThemeRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const PAGE = 1000;
      const all: any[] = [];
      for (let page = 0; page < 25; page += 1) {
        const { data, error } = await (supabase as any)
          .from("competitor_themes")
          .select("response_id, competitor_name, attribute_id, attribute_name, sentiment")
          .eq("company_id", currentCompanyId)
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (cancelled) return;
        if (error) {
          console.warn("competitor_themes fetch failed:", error.message);
          break;
        }
        all.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      if (!cancelled) setCompetitorThemeRows(all);
    })();
    return () => { cancelled = true; };
  }, [currentCompanyId]);

  // -------------------------------------------------------------------------
  // Curated Direct list (companies.competitors), run through the same
  // exclusion rules as detected names.
  // -------------------------------------------------------------------------
  const curatedDirect = useMemo(() => {
    const list = currentCompany?.competitors ?? [];
    return new Set(
      parseDetectedCompetitors(list.join(","), companyName, canonicalize),
    );
  }, [currentCompany?.competitors, companyName, canonicalize]);

  const isAliasMapped = useCallback(
    (name: string) => aliasMap.has(normalizeEntityName(name)),
    [aliasMap],
  );

  // -------------------------------------------------------------------------
  // SINGLE-PASS NORMALIZATION — parse detected_competitors and citations once
  // per response. The variant-collapse map is built over the union of both
  // periods so deltas compare like-for-like.
  // -------------------------------------------------------------------------
  const { normalized, prevNormalized } = useMemo(() => {
    type PreParsed = Omit<CompetitorNormalizedResponse, "competitors"> & { rawNames: string[] };
    const preParse = (input: any[]): PreParsed[] =>
      input.map((r) => {
        let parsed: any = r.citations;
        if (typeof parsed === "string") {
          try { parsed = JSON.parse(parsed); } catch { parsed = null; }
        }
        const arr = Array.isArray(parsed) ? enhanceCitations(parsed) : [];
        const seenDomains = new Set<string>();
        const domains: string[] = [];
        for (const c of arr) {
          if (c.type !== "website" || !c.domain) continue;
          const d = normalizeDomain(c.domain);
          if (d && d !== "unknown" && !seenDomains.has(d)) {
            seenDomains.add(d);
            domains.push(d);
          }
        }
        const tsRaw = r.tested_at || r.created_at;
        const ts = tsRaw ? Date.parse(tsRaw) : NaN;
        return {
          raw: r,
          id: r.id,
          mentioned: r.company_mentioned === true,
          model: r.ai_model || "",
          jobFunction: r.confirmed_prompts?.job_function_context?.trim() || null,
          location: r.confirmed_prompts?.location_context?.trim() || null,
          promptType: r.confirmed_prompts?.prompt_type,
          promptText: r.confirmed_prompts?.prompt_text,
          promptId: r.confirmed_prompts?.id ?? r.confirmed_prompt_id,
          testedAt: Number.isFinite(ts) ? ts : null,
          rawNames: parseDetectedCompetitors(r.detected_competitors, companyName, canonicalize),
          domains,
        };
      });

    const current = preParse(responses);
    const previous = preParse(previousPeriodResponses);

    const universe = new Set<string>();
    for (const nr of current) nr.rawNames.forEach((n) => universe.add(n));
    for (const nr of previous) nr.rawNames.forEach((n) => universe.add(n));
    // Variant collapse only runs once the alias map is loaded: with an empty
    // map nothing is protected, and "General Motors" briefly folded into a
    // junk standalone "General" token. Pre-load, names pass through as-is
    // (fragmented but correct beats merged but wrong).
    const collapseMap = aliasMapLoaded
      ? buildVariantCollapseMap(universe, { curated: curatedDirect, isAliasMapped })
      : new Map<string, string[]>();

    const finalize = (pre: PreParsed[]): CompetitorNormalizedResponse[] =>
      pre.map((nr) => {
        const seen = new Set<string>();
        const competitors: string[] = [];
        for (const name of nr.rawNames) {
          for (const target of collapseMap.get(name) ?? [name]) {
            const key = target.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              competitors.push(target);
            }
          }
        }
        const { rawNames: _drop, ...rest } = nr;
        return { ...rest, competitors };
      });

    return { normalized: finalize(current), prevNormalized: finalize(previous) };
  }, [responses, previousPeriodResponses, companyName, canonicalize, curatedDirect, isAliasMapped, aliasMapLoaded]);

  // Distinct job functions present on the prompts behind these responses.
  const uniqueJobFunctions = useMemo(() => {
    const fns = new Set<string>();
    normalized.forEach((nr) => { if (nr.jobFunction) fns.add(nr.jobFunction); });
    return Array.from(fns).sort();
  }, [normalized]);

  const matchesFilters = useCallback(
    (nr: CompetitorNormalizedResponse) =>
      selectedJobFunctionFilter === "all" || nr.jobFunction === selectedJobFunctionFilter,
    [selectedJobFunctionFilter],
  );

  // -------------------------------------------------------------------------
  // Aggregation over the analyzed scope (current + previous period).
  // -------------------------------------------------------------------------
  const buildAgg = (input: CompetitorNormalizedResponse[], filter: (nr: CompetitorNormalizedResponse) => boolean) => {
    const byName = new Map<string, CompetitorAgg>();
    const matching: CompetitorNormalizedResponse[] = [];
    let total = 0;
    let companyMentioned = 0;
    let discoveryTotal = 0;
    let discoveryMentioned = 0;
    let competitiveTotal = 0;
    let competitiveMentioned = 0;
    for (const nr of input) {
      if (!filter(nr)) continue;
      matching.push(nr);
      total += 1;
      const isDiscovery = nr.promptType === "discovery";
      const isCompetitive = nr.promptType === "competitive";
      if (isDiscovery) discoveryTotal += 1;
      if (isCompetitive) competitiveTotal += 1;
      if (nr.mentioned) {
        companyMentioned += 1;
        if (isDiscovery) discoveryMentioned += 1;
        if (isCompetitive) competitiveMentioned += 1;
      }
      for (const name of nr.competitors) {
        let agg = byName.get(name);
        if (!agg) {
          agg = { name, count: 0, coMention: 0, discoveryCount: 0, competitiveCount: 0, models: new Set(), responseIds: [] };
          byName.set(name, agg);
        }
        agg.count += 1;
        if (nr.mentioned) agg.coMention += 1;
        if (isDiscovery) agg.discoveryCount += 1;
        if (isCompetitive) agg.competitiveCount += 1;
        if (nr.model) agg.models.add(getLLMDisplayName(nr.model));
        agg.responseIds.push(nr.id);
      }
    }
    return { byName, matching, total, companyMentioned, discoveryTotal, discoveryMentioned, competitiveTotal, competitiveMentioned };
  };

  const analyzed = useMemo(() => buildAgg(normalized, matchesFilters), [normalized, matchesFilters]);
  const prevAnalyzed = useMemo(() => buildAgg(prevNormalized, matchesFilters), [prevNormalized, matchesFilters]);
  const hasPrevPeriod = prevAnalyzed.total > 0;

  // Set membership. "Employer of choice" = detected in discovery prompts
  // (prompts that don't name the measured company); "Direct" = the curated
  // list PLUS companies detected in competitive answers — most companies
  // never fill in the curated list (every Ford profile has competitors = []),
  // and the AI naming a company in a head-to-head comparison IS the direct
  // set in practice; "Emergent" = detected but in neither race (mentioned
  // only in experience/informational answers).
  const setOf = useCallback((agg: CompetitorAgg): CompetitorSet[] => {
    const sets: CompetitorSet[] = [];
    if (agg.discoveryCount > 0) sets.push("eoc");
    if (curatedDirect.has(agg.name) || agg.competitiveCount > 0) sets.push("direct");
    if (sets.length === 0) sets.push("emergent");
    return sets;
  }, [curatedDirect]);

  const totalModelCount = useMemo(() => {
    const models = new Set<string>();
    analyzed.matching.forEach((nr) => { if (nr.model) models.add(getLLMDisplayName(nr.model)); });
    return models.size;
  }, [analyzed]);

  // response_id → sentiment ratio for the measured company (methodology v2).
  const companySentimentById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of responseSentimentRows) {
      if (!row?.response_id) continue;
      let ratio: number | null;
      if (row.sentiment_ratio === null || row.sentiment_ratio === undefined) {
        ratio = sentimentRatioV2(Number(row.positive_themes) || 0, Number(row.negative_themes) || 0);
      } else {
        const n = typeof row.sentiment_ratio === "number" ? row.sentiment_ratio : Number(row.sentiment_ratio);
        ratio = Number.isFinite(n) ? n : null;
      }
      map.set(row.response_id, ratio);
    }
    return map;
  }, [responseSentimentRows]);

  // domain → average recency score (0-100). Freshness side of head-to-head.
  const domainRecencyAvg = useMemo(() => {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const row of recencyData) {
      const d = normalizeDomain(row?.domain || "");
      const score = Number(row?.recency_score);
      if (!d || !Number.isFinite(score)) continue;
      const agg = sums.get(d) ?? { sum: 0, n: 0 };
      agg.sum += score;
      agg.n += 1;
      sums.set(d, agg);
    }
    const map = new Map<string, number>();
    sums.forEach((v, k) => map.set(k, v.sum / v.n));
    return map;
  }, [recencyData]);

  // -------------------------------------------------------------------------
  // Competitor theme aggregation (per competitor: attribute counts + polarity;
  // per response: attribute sets for the modal's unique-attributes section).
  // Names are re-canonicalized + collapsed on read so admin alias edits made
  // after the rows were written still merge correctly.
  // -------------------------------------------------------------------------
  const inScopeResponseIds = useMemo(
    () => new Set(analyzed.matching.map((nr) => nr.id)),
    [analyzed],
  );

  const compThemes = useMemo(() => {
    const byCompetitor = new Map<string, {
      attrCounts: Map<string, { name: string; count: number }>;
      positive: number;
      negative: number;
      byResponse: Map<string, Set<string>>;
    }>();
    if (competitorThemeRows.length === 0) return byCompetitor;

    // Same alias-map gating as the main parse: no collapse before protection
    // data is available.
    const collapse = aliasMapLoaded
      ? buildVariantCollapseMap(
          new Set([...analyzed.byName.keys(), ...competitorThemeRows.map((r) => r.competitor_name)]),
          { curated: curatedDirect, isAliasMapped },
        )
      : new Map<string, string[]>();

    for (const row of competitorThemeRows) {
      if (!inScopeResponseIds.has(row.response_id)) continue;
      const canonical = canonicalize(row.competitor_name) ?? row.competitor_name;
      if (!canonical || isPlaceholder(canonical)) continue;
      for (const target of collapse.get(canonical) ?? [canonical]) {
        let agg = byCompetitor.get(target);
        if (!agg) {
          agg = { attrCounts: new Map(), positive: 0, negative: 0, byResponse: new Map() };
          byCompetitor.set(target, agg);
        }
        const attr = agg.attrCounts.get(row.attribute_id) ?? { name: row.attribute_name || row.attribute_id, count: 0 };
        attr.count += 1;
        agg.attrCounts.set(row.attribute_id, attr);
        if (row.sentiment === "positive") agg.positive += 1;
        else if (row.sentiment === "negative") agg.negative += 1;
        let respSet = agg.byResponse.get(row.response_id);
        if (!respSet) {
          respSet = new Set();
          agg.byResponse.set(row.response_id, respSet);
        }
        respSet.add(row.attribute_id);
      }
    }
    return byCompetitor;
  }, [competitorThemeRows, inScopeResponseIds, analyzed.byName, canonicalize, curatedDirect, isAliasMapped, aliasMapLoaded]);

  const hasAnyCompetitorThemes = compThemes.size > 0;

  // -------------------------------------------------------------------------
  // Card 1 — direct competitors: the curated list measured on COMPETITIVE
  // prompts (the head-to-head comparison questions). The discovery race has
  // its own card (Employers of choice); emergent competitors live in the
  // table behind the Set filter.
  // -------------------------------------------------------------------------
  type SetRow = {
    name: string;
    isCompany: boolean;
    coverage: number;      // %
    prevCoverage: number | null;
  };

  const card1Rows = useMemo((): SetRow[] => {
    const rows: SetRow[] = [];
    const denom = analyzed.competitiveTotal;
    const prevDenom = prevAnalyzed.competitiveTotal;

    const namesInSet = new Set<string>();
    analyzed.byName.forEach((agg) => {
      if (setOf(agg).includes("direct")) namesInSet.add(agg.name);
    });
    // Also list curated competitors that never appear — a curated rival with
    // zero visibility is a finding, not a data gap.
    curatedDirect.forEach((n) => namesInSet.add(n));

    namesInSet.forEach((name) => {
      const agg = analyzed.byName.get(name);
      const prevAgg = prevAnalyzed.byName.get(name);
      const count = agg?.competitiveCount ?? 0;
      const prevCount = prevAgg?.competitiveCount ?? 0;
      rows.push({
        name,
        isCompany: false,
        coverage: denom > 0 ? (count / denom) * 100 : 0,
        prevCoverage: hasPrevPeriod && prevCount > 0 && prevDenom > 0 ? (prevCount / prevDenom) * 100 : null,
      });
    });

    // The measured company, pinned into its true position.
    rows.push({
      name: companyName,
      isCompany: true,
      coverage: denom > 0 ? (analyzed.competitiveMentioned / denom) * 100 : 0,
      prevCoverage: hasPrevPeriod && prevDenom > 0 ? (prevAnalyzed.competitiveMentioned / prevDenom) * 100 : null,
    });

    return rows.sort((a, b) => b.coverage - a.coverage);
  }, [analyzed, prevAnalyzed, setOf, curatedDirect, companyName, hasPrevPeriod]);

  // Top rows plus the company row pinned in even when it ranks below the cut.
  const card1Visible = useMemo(() => {
    const top = card1Rows.slice(0, CARD1_ROW_LIMIT);
    if (!top.some((r) => r.isCompany)) {
      const companyRow = card1Rows.find((r) => r.isCompany);
      if (companyRow) top.push(companyRow);
    }
    return top;
  }, [card1Rows]);

  // Line view — share-of-voice trend: % of each period bucket's competitive
  // answers mentioning the entity, for the top direct competitors plus the
  // measured company.
  const trend = useMemo(() => {
    const topCompetitors = card1Rows
      .filter((r) => !r.isCompany)
      .slice(0, TREND_COMPETITOR_LIMIT)
      .map((r) => r.name);
    const series = [companyName, ...topCompetitors];
    const empty = { data: [] as Record<string, any>[], series, granularity: "week" as TrendGranularity };

    const scope = analyzed.matching.filter((nr) => nr.promptType === "competitive");
    if (scope.length === 0) return empty;

    let minTs = Infinity;
    let maxTs = -Infinity;
    const monthKeys = new Set<string>();
    for (const nr of scope) {
      if (nr.testedAt == null) continue;
      if (nr.testedAt < minTs) minTs = nr.testedAt;
      if (nr.testedAt > maxTs) maxTs = nr.testedAt;
      const d = new Date(nr.testedAt);
      monthKeys.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    if (!Number.isFinite(minTs)) return empty;

    const granularity: TrendGranularity = monthKeys.size > 2 ? "month" : "week";
    const bucketOf = granularity === "month" ? startOfMonthTs : startOfWeekTs;

    const bucketStarts: number[] = [];
    let cursor = bucketOf(minTs);
    const last = bucketOf(maxTs);
    while (cursor <= last && bucketStarts.length < 60) {
      bucketStarts.push(cursor);
      const d = new Date(cursor);
      if (granularity === "month") d.setMonth(d.getMonth() + 1);
      else d.setDate(d.getDate() + 7);
      cursor = d.getTime();
    }

    const multiYear = new Date(minTs).getFullYear() !== new Date(maxTs).getFullYear();
    type Bucket = { row: Record<string, any>; total: number; counts: number[] };
    const buckets = new Map<number, Bucket>();
    const data = bucketStarts.map((ts) => {
      const d = new Date(ts);
      const label = granularity === "month"
        ? d.toLocaleDateString("en-US", multiYear ? { month: "short", year: "2-digit" } : { month: "short" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const row: Record<string, any> = { ts, label };
      series.forEach((_, i) => { row[`s${i}`] = 0; });
      buckets.set(ts, { row, total: 0, counts: series.map(() => 0) });
      return row;
    });

    for (const nr of scope) {
      if (nr.testedAt == null) continue;
      const bucket = buckets.get(bucketOf(nr.testedAt));
      if (!bucket) continue;
      bucket.total += 1;
      if (nr.mentioned) bucket.counts[0] += 1;
      for (let i = 1; i < series.length; i += 1) {
        if (nr.competitors.includes(series[i])) bucket.counts[i] += 1;
      }
    }
    buckets.forEach((bucket) => {
      series.forEach((_, i) => {
        bucket.row[`s${i}`] = bucket.total > 0
          ? Math.round((bucket.counts[i] / bucket.total) * 1000) / 10
          : 0;
      });
    });

    return { data, series, granularity };
  }, [card1Rows, analyzed, companyName]);

  // -------------------------------------------------------------------------
  // Card 2 — employers of choice: the discovery-prompt race. Coverage = % of
  // discovery answers (prompts that don't name the measured company)
  // surfacing each company, with the measured company pinned into its true
  // rank.
  // -------------------------------------------------------------------------
  const eocRows = useMemo((): SetRow[] => {
    const rows: SetRow[] = [];
    const denom = analyzed.discoveryTotal;
    const prevDenom = prevAnalyzed.discoveryTotal;
    analyzed.byName.forEach((agg) => {
      if (agg.discoveryCount === 0) return;
      const prevAgg = prevAnalyzed.byName.get(agg.name);
      const prevCount = prevAgg?.discoveryCount ?? 0;
      rows.push({
        name: agg.name,
        isCompany: false,
        coverage: denom > 0 ? (agg.discoveryCount / denom) * 100 : 0,
        prevCoverage: hasPrevPeriod && prevCount > 0 && prevDenom > 0 ? (prevCount / prevDenom) * 100 : null,
      });
    });
    rows.push({
      name: companyName,
      isCompany: true,
      coverage: denom > 0 ? (analyzed.discoveryMentioned / denom) * 100 : 0,
      prevCoverage: hasPrevPeriod && prevDenom > 0 ? (prevAnalyzed.discoveryMentioned / prevDenom) * 100 : null,
    });
    return rows.sort((a, b) => b.coverage - a.coverage);
  }, [analyzed, prevAnalyzed, hasPrevPeriod, companyName]);

  // Top rows plus the company row pinned in even when it ranks below the cut.
  const eocVisible = useMemo(() => {
    const top = eocRows.slice(0, EOC_ROW_LIMIT);
    if (!top.some((r) => r.isCompany)) {
      const companyRow = eocRows.find((r) => r.isCompany);
      if (companyRow) top.push(companyRow);
    }
    return top;
  }, [eocRows]);

  // -------------------------------------------------------------------------
  // Card 3 — table rows with filters + sorting.
  // -------------------------------------------------------------------------
  type TableRowData = {
    name: string;
    sets: CompetitorSet[];
    attributes: Array<{ id: string; name: string; count: number }>;
    models: string[];
    sentiment: number | null;
    coverage: number;
    prevCoverage: number | null;
    count: number;
  };

  const allTableRows = useMemo((): TableRowData[] => {
    const rows: TableRowData[] = [];
    analyzed.byName.forEach((agg) => {
      const themes = compThemes.get(agg.name);
      const attributes = themes
        ? Array.from(themes.attrCounts.entries())
            .map(([id, v]) => ({ id, name: v.name, count: v.count }))
            .sort((a, b) => b.count - a.count)
        : [];
      const prevAgg = prevAnalyzed.byName.get(agg.name);
      rows.push({
        name: agg.name,
        sets: setOf(agg),
        attributes,
        models: Array.from(agg.models).sort(),
        sentiment: themes ? sentimentRatioV2(themes.positive, themes.negative) : null,
        coverage: analyzed.total > 0 ? (agg.count / analyzed.total) * 100 : 0,
        prevCoverage: hasPrevPeriod && prevAgg && prevAnalyzed.total > 0
          ? (prevAgg.count / prevAnalyzed.total) * 100
          : null,
        count: agg.count,
      });
    });
    return rows;
  }, [analyzed, prevAnalyzed, compThemes, setOf, hasPrevPeriod]);

  const sentimentBucket = (ratio: number | null): "positive" | "neutral" | "negative" | null => {
    if (typeof ratio !== "number") return null;
    if (ratio > 0.6) return "positive";
    if (ratio < 0.4) return "negative";
    return "neutral";
  };

  const filteredTableRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const setFilter = new Set(filterSets);
    const attrFilter = new Set(filterAttributes);
    const modelFilter = new Set(filterModels);
    const sentFilter = new Set(filterSentiments);
    const rows = allTableRows.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (setFilter.size > 0 && !row.sets.some((s) => setFilter.has(s))) return false;
      if (attrFilter.size > 0 && !row.attributes.some((a) => attrFilter.has(a.id))) return false;
      if (modelFilter.size > 0 && !row.models.some((m) => modelFilter.has(m))) return false;
      if (sentFilter.size > 0) {
        const bucket = sentimentBucket(row.sentiment);
        if (!bucket || !sentFilter.has(bucket)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "name": return dir * a.name.localeCompare(b.name);
        case "attributes": return dir * (a.attributes.length - b.attributes.length);
        case "models": return dir * (a.models.length - b.models.length);
        case "sentiment": {
          // Nulls always sink to the bottom regardless of direction.
          if (a.sentiment === null && b.sentiment === null) return 0;
          if (a.sentiment === null) return 1;
          if (b.sentiment === null) return -1;
          return dir * (a.sentiment - b.sentiment);
        }
        default: return dir * (a.coverage - b.coverage) || dir * (a.count - b.count);
      }
    });
  }, [allTableRows, searchQuery, filterSets, filterAttributes, filterModels, filterSentiments, sortKey, sortDir]);

  const tableFilterOptions = useMemo(() => {
    const setCounts = new Map<CompetitorSet, number>();
    const attrCounts = new Map<string, { name: string; count: number }>();
    const modelCounts = new Map<string, number>();
    const sentCounts = new Map<string, number>();
    for (const row of allTableRows) {
      row.sets.forEach((s) => setCounts.set(s, (setCounts.get(s) || 0) + 1));
      row.attributes.forEach((a) => {
        const agg = attrCounts.get(a.id) ?? { name: a.name, count: 0 };
        agg.count += 1;
        attrCounts.set(a.id, agg);
      });
      row.models.forEach((m) => modelCounts.set(m, (modelCounts.get(m) || 0) + 1));
      const bucket = sentimentBucket(row.sentiment);
      if (bucket) sentCounts.set(bucket, (sentCounts.get(bucket) || 0) + 1);
    }
    return {
      sets: (Object.keys(SET_LABELS) as CompetitorSet[])
        .filter((s) => setCounts.has(s))
        .map((s) => ({ value: s, label: SET_LABELS[s], count: setCounts.get(s) })),
      attributes: Array.from(attrCounts.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([id, v]) => ({
          value: id,
          label: v.name,
          count: v.count,
          adornment: (() => {
            const Icon = getAttributeIconByName(v.name);
            return <Icon className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />;
          })(),
        })),
      models: Array.from(modelCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: value,
          count,
          adornment: <LLMLogo modelName={value} size="sm" showFallback={false} />,
        })),
      sentiments: ["positive", "neutral", "negative"]
        .filter((s) => sentCounts.has(s))
        .map((value) => ({ value, label: value, count: sentCounts.get(value) })),
    };
  }, [allTableRows]);

  const activeFilterCount =
    filterSets.length + filterAttributes.length + filterModels.length + filterSentiments.length;

  const clearAllFilters = () => {
    setFilterSets([]);
    setFilterAttributes([]);
    setFilterModels([]);
    setFilterSentiments([]);
  };

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------
  const scrollToTableRow = useCallback((name: string) => {
    const idx = filteredTableRows.findIndex((r) => r.name === name);
    if (idx >= visibleRows) setVisibleRows(idx + 10);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rowRefs.current.get(name)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }, [filteredTableRows, visibleRows]);

  // Card 1/2 rows select the competitor (Card 2 emphasis) and jump to its
  // table row; table rows open the detail modal.
  const handleChartRowClick = (name: string) => {
    setSelectedCompetitor(name);
    scrollToTableRow(name);
  };

  const openModal = (name: string) => {
    setModalCompetitor(name);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalCompetitor(null);
  };

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  // -------------------------------------------------------------------------
  // Small render helpers
  // -------------------------------------------------------------------------
  const renderDeltaChip = (current: number, previous: number | null) => {
    if (previous === null) return null;
    const delta = Math.round(current - previous);
    if (delta === 0) return <span className="text-xs text-gray-400">-</span>;
    return (
      <span className={`text-xs font-semibold flex items-center gap-0.5 ${delta > 0 ? "text-green-600" : "text-red-600"}`}>
        {delta > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
        <span className="whitespace-nowrap">{Math.abs(delta)}%</span>
      </span>
    );
  };

  const CompetitorFavicon = ({ name, isCompany }: { name: string; isCompany?: boolean }) => {
    const src = getCompetitorFavicon(name);
    return (
      <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 overflow-hidden ${isCompany ? "bg-[#0DBCBA]/10" : "bg-gray-100"}`}>
        {src ? (
          <img
            src={src}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty("display", "flex");
            }}
          />
        ) : null}
        <span
          className={`text-[9px] font-bold ${isCompany ? "text-[#0DBCBA]" : "text-gray-500"}`}
          style={{ display: src ? "none" : "flex" }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      </span>
    );
  };

  const sentimentPill = (ratio: number | null) => {
    if (ratio === null) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-gray-400 cursor-help">—</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px]">
              <p className="text-xs">
                No competitor sentiment yet — it accrues as new answers are
                collected and themed.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    let cls = "bg-gray-100 text-gray-600";
    let label = "Neutral";
    if (ratio > 0.6) { cls = "bg-green-100 text-green-700"; label = "Positive"; }
    else if (ratio < 0.4) { cls = "bg-red-100 text-red-700"; label = "Negative"; }
    return <Badge className={`${cls} border-0 text-xs font-medium pointer-events-none`}>{label}</Badge>;
  };

  const SortableHead = ({ label, k, className }: { label: string; k: typeof sortKey; className?: string }) => (
    <TableHead
      className={`cursor-pointer select-none hover:text-gray-900 ${className ?? ""}`}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && <span className="text-[10px] text-gray-400">{sortDir === "desc" ? "▼" : "▲"}</span>}
      </span>
    </TableHead>
  );

  const TrendTooltipContent = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const rows = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0));
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md min-w-[190px]">
        <p className="text-xs font-semibold text-gray-900 mb-1.5">{label}</p>
        {rows.map((p) => (
          <div key={p.name} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
            <span className="text-xs text-gray-600 truncate max-w-[140px]">{p.name}</span>
            <span className="ml-auto text-xs font-semibold text-gray-900 tabular-nums pl-3">{p.value}%</span>
          </div>
        ))}
      </div>
    );
  };

  const axisTickStyle = { fontSize: 11, fill: "#9CA3AF" } as const;

  const hasAnyData = analyzed.byName.size > 0 || curatedDirect.size > 0;
  const totalDetected = analyzed.byName.size;

  // Modal data for the selected competitor.
  const modalAgg = modalCompetitor ? analyzed.byName.get(modalCompetitor) : undefined;
  const modalThemes = modalCompetitor ? compThemes.get(modalCompetitor) : undefined;

  // ==========================================================================
  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Section header */}
      <div className="space-y-2" data-tour="competitors-heading">
        <h2 className="text-2xl font-bold text-gray-900">Competitors</h2>
        <p className="text-gray-600">
          Who AI models surface alongside {companyName} — and where they win the answers you don't.
        </p>
      </div>

      {/* Global job function filter */}
      {uniqueJobFunctions.length > 0 && (
        <div className="sticky top-0 z-10 bg-white pb-2">
          <ScrollablePills
            selected={selectedJobFunctionFilter}
            onSelect={setSelectedJobFunctionFilter}
            options={[
              { value: "all", label: "All functions" },
              ...uniqueJobFunctions.map((fn) => ({ value: fn, label: fn })),
            ]}
          />
        </div>
      )}

      {!hasAnyData && !responsesLoading ? (
        <Card className="shadow-sm border border-gray-200">
          <CardContent className="p-6">
            <div className="text-center py-12 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-sm">No competitors detected yet.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Row 1: competitive set + when they appear */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
            {/* ------------------------------------------------ Card 1 */}
            <Card data-tour="competitors-chart" className="shadow-sm border border-gray-200 lg:col-span-3 flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-bold text-gray-800">Direct competitors</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {/* Bar / line toggle */}
                    <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-100">
                      <button
                        onClick={() => setChartType("bar")}
                        title="Coverage ranking"
                        aria-label="Coverage ranking"
                        className={`px-2 py-1 rounded-md transition-all ${
                          chartType === "bar" ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        <BarChartHorizontal className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setChartType("line")}
                        title="Share-of-voice trend"
                        aria-label="Share-of-voice trend"
                        className={`px-2 py-1 rounded-md transition-all ${
                          chartType === "line" ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
                        }`}
                      >
                        <ChartLine className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 flex items-center gap-1 pt-1">
                  % of competitive answers (comparison questions) mentioning each company
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help"><Info className="w-3.5 h-3.5" /></span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[290px]">
                        <p className="text-xs">
                          Companies the AI names in comparison answers, plus your
                          curated competitor list (curated rivals show even at 0%).
                          Your row is pinned at its true rank. Answers mention
                          several companies, so percentages don't sum to 100.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col pt-2">
                {responsesLoading && totalDetected === 0 ? (
                  <div className="flex-1 min-h-[280px] rounded-md bg-gray-100 animate-pulse" aria-busy="true" />
                ) : chartType === "line" ? (
                  <>
                    <div className="flex-1 min-h-[280px]">
                      {trend.data.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400">
                          No trend data for this period.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trend.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="#F3F4F6" />
                            <XAxis dataKey="label" tick={axisTickStyle} tickLine={false} axisLine={false} minTickGap={24} />
                            <YAxis width={38} tick={axisTickStyle} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                            <RechartsTooltip content={<TrendTooltipContent />} cursor={{ stroke: "#E5E7EB" }} />
                            {trend.series.map((name, i) => (
                              <Line
                                key={name}
                                type="monotone"
                                dataKey={`s${i}`}
                                name={name}
                                stroke={CHART_COLORS[i]}
                                strokeWidth={i === 0 ? 3 : 2}
                                dot={trend.data.length <= 10 ? { r: 3, fill: CHART_COLORS[i], stroke: "#fff", strokeWidth: 1.5 } : false}
                                activeDot={{ r: 4, fill: CHART_COLORS[i], stroke: "#fff", strokeWidth: 2 }}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                    {/* Legend: identity via favicon + name, never color alone */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 px-1">
                      {trend.series.map((name, i) => (
                        <button
                          key={name}
                          onClick={() => i > 0 && handleChartRowClick(name)}
                          className={`flex items-center gap-1.5 min-w-0 ${i > 0 ? "group cursor-pointer" : "cursor-default"}`}
                        >
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_COLORS[i] }} />
                          <CompetitorFavicon name={name} isCompany={i === 0} />
                          <span className={`text-xs truncate max-w-[150px] ${i === 0 ? "font-semibold text-gray-900" : "text-gray-600 group-hover:text-gray-900"}`}>
                            {name}{i === 0 ? " (you)" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 min-h-[280px] space-y-1">
                    {analyzed.competitiveTotal === 0 ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">
                        No competitive-prompt answers in this period.
                      </div>
                    ) : card1Visible.length <= 1 ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">
                        No competitors detected in comparison answers yet.
                      </div>
                    ) : (
                      (() => {
                        const maxCoverage = Math.max(...card1Visible.map((r) => r.coverage), 1);
                        return card1Visible.map((row, idx) => {
                          const rank = card1Rows.findIndex((r) => r.name === row.name) + 1;
                          return (
                            <button
                              key={row.name}
                              onClick={() => { if (!row.isCompany) handleChartRowClick(row.name); }}
                              className={`w-full text-left px-2 sm:px-3 py-1.5 rounded-lg transition-colors ${
                                row.isCompany
                                  ? "bg-[#0DBCBA]/5 border border-[#0DBCBA]/30 cursor-default"
                                  : "hover:bg-gray-50 cursor-pointer"
                              } ${selectedCompetitor === row.name ? "ring-1 ring-[#0DBCBA]/60" : ""}`}
                              {...(idx === 0 ? { "data-tour": "competitors-first-row" } : {})}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="w-5 text-right text-xs font-medium text-gray-400 tabular-nums flex-shrink-0">{rank}</span>
                                <CompetitorFavicon name={row.name} isCompany={row.isCompany} />
                                <span className={`text-sm truncate ${row.isCompany ? "font-bold text-gray-900" : "font-medium text-gray-900"}`} title={row.name}>
                                  {row.name}
                                </span>
                                {row.isCompany && (
                                  <Badge className="bg-[#0DBCBA]/15 text-[#0B9E9C] border-0 text-[10px] font-semibold px-1.5 py-0 pointer-events-none">
                                    You
                                  </Badge>
                                )}
                                <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{row.coverage.toFixed(1)}%</span>
                                  <span className="w-[45px] flex justify-end">{renderDeltaChip(row.coverage, row.prevCoverage)}</span>
                                </span>
                              </div>
                              <div className="mt-1 ml-[30px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${(row.coverage / maxCoverage) * 100}%`,
                                    backgroundColor: row.isCompany ? BRAND_COLOR : COMPETITOR_BAR_COLOR,
                                  }}
                                />
                              </div>
                            </button>
                          );
                        });
                      })()
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ------------------------------------------------ Card 2 */}
            <Card data-tour="competitors-eoc" className="shadow-sm border border-gray-200 lg:col-span-2 flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <CardTitle className="text-base font-bold text-gray-800">Employers of choice</CardTitle>
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-xs">
                      {eocRows.filter((r) => !r.isCompany).length.toLocaleString()}
                    </Badge>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-gray-400 flex-shrink-0"><Info className="w-3.5 h-3.5" /></span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px]">
                        <p className="text-xs">
                          The open race: % of discovery answers (prompts that don't
                          name {companyName}) surfacing each company. Your row is
                          pinned at its true rank. Answers surface several
                          companies, so percentages don't sum to 100.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <p className="text-xs text-gray-400 pt-1">% of discovery answers surfacing each company</p>
              </CardHeader>
              <CardContent className="flex-1 pt-2">
                {responsesLoading && totalDetected === 0 ? (
                  <div className="space-y-3 py-2" aria-busy="true">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="h-9 rounded-md bg-gray-100 animate-pulse" />
                    ))}
                  </div>
                ) : analyzed.discoveryTotal === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400 py-10">
                    No discovery answers in this period.
                  </div>
                ) : (
                  <div className="space-y-0.5 max-h-[420px] overflow-y-auto pr-1">
                    {(() => {
                      const maxCoverage = Math.max(...eocVisible.map((r) => r.coverage), 1);
                      return eocVisible.map((row) => {
                        const rank = eocRows.findIndex((r) => r.name === row.name) + 1;
                        return (
                          <button
                            key={row.name}
                            onClick={() => { if (!row.isCompany) handleChartRowClick(row.name); }}
                            className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${
                              row.isCompany
                                ? "bg-[#0DBCBA]/5 border border-[#0DBCBA]/30 cursor-default"
                                : "hover:bg-gray-50 cursor-pointer"
                            } ${selectedCompetitor === row.name ? "ring-1 ring-[#0DBCBA]/60" : ""}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-5 text-right text-xs font-medium text-gray-400 tabular-nums flex-shrink-0">{rank}</span>
                              <CompetitorFavicon name={row.name} isCompany={row.isCompany} />
                              <span className={`text-sm truncate ${row.isCompany ? "font-bold text-gray-900" : "font-medium text-gray-900"}`} title={row.name}>
                                {row.name}
                              </span>
                              {row.isCompany && (
                                <Badge className="bg-[#0DBCBA]/15 text-[#0B9E9C] border-0 text-[10px] font-semibold px-1.5 py-0 pointer-events-none">
                                  You
                                </Badge>
                              )}
                              <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-sm font-semibold text-gray-900 tabular-nums">{row.coverage.toFixed(1)}%</span>
                                <span className="w-[45px] flex justify-end">{renderDeltaChip(row.coverage, row.prevCoverage)}</span>
                              </span>
                            </div>
                            <div className="mt-1 ml-[30px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${(row.coverage / maxCoverage) * 100}%`,
                                  backgroundColor: row.isCompany ? BRAND_COLOR : COMPETITOR_BAR_COLOR,
                                }}
                              />
                            </div>
                          </button>
                        );
                      });
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ------------------------------------------------ Card 3: table */}
          <Card data-tour="competitors-table" className="shadow-sm border border-gray-200">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base font-bold text-gray-800">Competitors</CardTitle>
                <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-xs">
                  {totalDetected.toLocaleString()}
                </Badge>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="h-6 px-2 text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear filters ({activeFilterCount})
                  </Button>
                )}
              </div>
              {/* Filter row: search, Set, Attributes, Models, Sentiment. Job
                  function and market are global — never duplicated here. */}
              <div className="flex items-center gap-2 flex-wrap pt-2">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search competitors..."
                  className="max-w-xs"
                />
                <FilterDropdown label="Set" icon={Layers} options={tableFilterOptions.sets} selected={filterSets} onChange={setFilterSets} />
                <FilterDropdown label="Attributes" icon={Tags} options={tableFilterOptions.attributes} selected={filterAttributes} onChange={setFilterAttributes} searchable />
                <FilterDropdown label="Models" icon={Bot} options={tableFilterOptions.models} selected={filterModels} onChange={setFilterModels} />
                <FilterDropdown label="Sentiment" icon={SmilePlus} options={tableFilterOptions.sentiments} selected={filterSentiments} onChange={setFilterSentiments} />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {responsesLoading && totalDetected === 0 ? (
                <div className="space-y-3 py-2" aria-busy="true">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-9 rounded-md bg-gray-100 animate-pulse" />
                  ))}
                </div>
              ) : filteredTableRows.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-sm">
                    {searchQuery.trim() || activeFilterCount > 0
                      ? "No competitors match the current filters."
                      : "No competitors detected in this period."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <SortableHead label="Competitor" k="name" className="min-w-[180px]" />
                          <SortableHead label="Owns attribute" k="attributes" className="min-w-[190px]" />
                          <SortableHead label="Models" k="models" className="min-w-[120px]" />
                          <SortableHead label="Sentiment" k="sentiment" className="min-w-[100px]" />
                          <SortableHead label="Coverage" k="coverage" className="min-w-[110px] text-right" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTableRows.slice(0, visibleRows).map((row) => (
                          <TableRow
                            key={row.name}
                            ref={(el) => {
                              if (el) rowRefs.current.set(row.name, el);
                              else rowRefs.current.delete(row.name);
                            }}
                            onClick={() => openModal(row.name)}
                            className={`cursor-pointer transition-colors ${
                              selectedCompetitor === row.name ? "bg-[#0DBCBA]/5" : ""
                            }`}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2 min-w-0">
                                <CompetitorFavicon name={row.name} />
                                <span className="text-sm font-medium text-gray-900 truncate" title={row.name}>{row.name}</span>
                                {row.sets.includes("direct") && (
                                  <Badge variant="secondary" className="bg-gray-100 text-gray-500 border-0 text-[10px] px-1.5 py-0 pointer-events-none flex-shrink-0">
                                    Direct
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {row.attributes.length === 0 ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {row.attributes.slice(0, OWNS_ATTRIBUTE_CHIPS).map((a) => {
                                    const Icon = getAttributeIconByName(a.name);
                                    return (
                                      <span key={a.id} className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 text-[11px]">
                                        <Icon className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate max-w-[110px]">{a.name}</span>
                                      </span>
                                    );
                                  })}
                                  {row.attributes.length > OWNS_ATTRIBUTE_CHIPS && (
                                    <span className="text-[11px] text-gray-400">+{row.attributes.length - OWNS_ATTRIBUTE_CHIPS}</span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {row.models.slice(0, 5).map((m) => (
                                  <LLMLogo key={m} modelName={m} size="sm" showFallback={false} />
                                ))}
                                <span className="text-xs text-gray-500 ml-1 whitespace-nowrap">
                                  {row.models.length} of {totalModelCount}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{sentimentPill(row.sentiment)}</TableCell>
                            <TableCell className="text-right">
                              <span className="inline-flex items-center gap-1.5 justify-end">
                                <span className="text-sm font-semibold text-gray-900 tabular-nums">{row.coverage.toFixed(1)}%</span>
                                <span className="w-[45px] flex justify-end">{renderDeltaChip(row.coverage, row.prevCoverage)}</span>
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {filteredTableRows.length > visibleRows && (
                    <div className="flex justify-center pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVisibleRows((v) => v + TABLE_ROWS_STEP)}
                        className="text-xs"
                      >
                        Show more ({filteredTableRows.length - visibleRows} remaining)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Detail modal */}
      {modalCompetitor && (
        <CompetitorDetailsModal
          isOpen={isModalOpen}
          onClose={closeModal}
          competitorName={modalCompetitor}
          companyName={companyName}
          companyId={currentCompanyId}
          analyzedResponses={analyzed.matching}
          totals={{
            total: analyzed.total,
            companyMentioned: analyzed.companyMentioned,
          }}
          competitorAgg={modalAgg ? {
            count: modalAgg.count,
            coMention: modalAgg.coMention,
            responseIds: modalAgg.responseIds,
          } : null}
          competitorThemeAgg={modalThemes ? {
            positive: modalThemes.positive,
            negative: modalThemes.negative,
            byResponse: modalThemes.byResponse,
            attrNames: new Map(Array.from(modalThemes.attrCounts.entries()).map(([id, v]) => [id, v.name])),
          } : null}
          hasCompetitorThemeData={hasAnyCompetitorThemes}
          companySentimentById={companySentimentById}
          domainRecencyAvg={domainRecencyAvg}
          responseTexts={responseTexts}
          fetchResponseTexts={fetchResponseTexts}
          onOpenSourcesForDomain={onNavigateToSources ? handleOpenSourcesForDomain : undefined}
        />
      )}
    </div>
  );
});

CompetitorsTab.displayName = "CompetitorsTab";
