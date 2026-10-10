import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DataUnavailable } from './DataUnavailable';
import type { DashboardFamilyStatus } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePersistedState } from '@/hooks/usePersistedState';
import { sentimentRatioV2, isExcludedAiModel } from '@/lib/sentimentV2';
import { supabase } from '@/integrations/supabase/client';
import { enhanceCitations, extractSourceUrl } from '@/utils/citationUtils';
import { quarterKeyOfMonthStr } from '@/utils/quarterKey';
import type { ScopeStatsRow, ScopePromptTypeStatsRow } from '@/hooks/dashboard/dashboardQueries';
import {
  BarChart3,
  Activity,
  Target,
  Award,
  Users,
  Heart,
  Shield,
  Lightbulb,
  Coffee,
  Crown,
  Lock,
  FileText,
  MessageSquare,
  ClipboardList,
  MessageCircle,
  UserCheck,
  Briefcase,
  Info,
  X,
  Check,
  AlertCircle,
  RefreshCw,
  Layers,
  Tags,
  Globe,
  Bot
} from 'lucide-react';
import { PromptResponse } from '@/types/dashboard';
import { ATTRIBUTES, normalizeAttributeId, getAttributeIdByName } from '@/config/attributes';
import { ATTRIBUTE_ICONS } from '@/config/attributeIcons';
import { getLLMDisplayName, getLLMLogo } from '@/config/llmLogos';
import { Favicon } from '@/components/ui/favicon';
import LLMLogo from '@/components/LLMLogo';
import { useTabSearchSeed } from '@/contexts/TabSearchSeedContext';
import { locationFlag, locationDisplayName } from '@/utils/locationContext';
import { SearchInput } from './SearchInput';
import { FilterDropdown } from './FilterDropdown';
import { TablePagination } from './TablePagination';

interface ThematicAnalysisTabProps {
  responses: PromptResponse[];
  companyName: string;
  aiThemes: AITheme[];
  aiThemesLoading: boolean;
  // Pre-aggregated attribute scores (company_attribute_themes_mv). Powers the
  // attribute views instantly; raw ai_themes load in the background only for
  // the per-attribute drilldown.
  attributeThemes?: any[];
  // Lazily loads the raw ai_themes for ONE attribute (the open drilldown).
  // The main views render from the attribute MV; only the drilldown needs
  // subtheme-level rows, so nothing is fetched until one opens. Rows
  // accumulate in the hook across drilled attributes.
  fetchAIThemesForAttribute?: (attributeId: string) => Promise<void> | void;
  // v2 attribute ids whose raw themes are fully loaded for the current scope.
  aiThemeAttrsLoaded?: string[];
  onRefreshThemes: () => Promise<void>;
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  previousPeriodResponses?: PromptResponse[];
  // True while the raw response stream for the current company is still
  // arriving (it loads AFTER first paint). Gates the empty state: skeleton
  // cards, never "No Experience Data", until the stream is final.
  responsesLoading?: boolean;
  // Reliability-audit failure states: the attribute-theme family's status and
  // the response-stream failure flag, plus a targeted retry. A failed request
  // renders "Couldn't load …" + Retry — never "No Themes Found" /
  // "No Experience Data", and never a permanent skeleton.
  themesStatus?: DashboardFamilyStatus;
  streamError?: boolean;
  onRetry?: () => void;
  // Global job-function filter, shared across all dashboard tabs and owned by
  // the parent Dashboard so a selection persists when switching tabs.
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
  // Explicit period scoping for the MV rows (quarter of response_month) plus
  // scope-cube rows for the pills and the empty-state gate — removes this
  // tab's dependency on the raw response stream having loaded. undefined =
  // not wired → legacy response-derived scoping.
  cubeQuarterKey?: string | null; // null = single period → no filter
  // 'YYYY-MM' floor bounding MV/cube months to the raw stream window when the
  // quarter filter is bypassed (dormant-resumed histories stay consistent
  // with the stream-fed drilldowns).
  cubeMonthFloor?: string | null;
  cubeScopeRows?: ScopeStatsRow[];
  cubePromptTypeRows?: ScopePromptTypeStatsRow[];
  // Measured company id.
  currentCompanyId?: string;
  // url_recency_cache rows {url, domain, recency_score 0-100} — the citation
  // freshness score behind the attributes table's Relevance column, the same
  // rows the Overview scorecard and Competitors head-to-head read.
  recencyData?: any[];
  recencyDataLoading?: boolean;
}

interface AITheme {
  id: string;
  response_id: string;
  theme_name: string;
  theme_description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  attribute_id: string;
  attribute_name: string;
  confidence_score: number;
  keywords: string[];
  context_snippets: string[];
  created_at: string;
}

// Icon mapping for attributes (methodology v2 — 13 attributes). Legacy v1 keys
// are kept so existing-client dashboards still show icons on historical data.
// Attribute icons live in @/config/attributeIcons so every surface (Themes,
// Sources) labels an attribute with the same mark.

// ---- Design tokens (perceptionx design system) -----------------------------
const INK = '#13274F';
const INK_MUTED = 'rgba(19,39,79,0.64)';
const INK_DIM = 'rgba(19,39,79,0.42)';
const RULE = 'rgba(19,39,79,0.12)';
const RULE_STRONG = 'rgba(19,39,79,0.22)';
const CARD_FILL = 'rgba(19,39,79,0.04)';
const BAR_TRACK = 'rgba(219,94,137,0.13)';
const PINK = '#DB5E89';
const TEAL = '#0DBCBA';
const NAVY_60 = '#4A5F86';
const CARD_LIGHT = '#F7F8FA';
// Sentiment washes and tile strips for the drilldown's split tiles.
const WASH: Record<'positive' | 'neutral' | 'negative', string> = {
  positive: '#E4F5F5',
  neutral: '#EEF1F4',
  negative: '#FBEEF2',
};

// Sentiment color scale — breaks on the same 60% cut as the grouping rule so
// nothing below the cut ever reads teal.
const sentimentColor = (pct: number) => {
  if (pct >= 75) return '#0DBCBA';
  if (pct >= 60) return '#7FDEDC';
  if (pct >= 45) return '#F2B3C4';
  return '#DB5E89';
};

const POLARITY_COLOR: Record<'positive' | 'neutral' | 'negative', string> = {
  positive: TEAL,
  neutral: RULE_STRONG,
  negative: PINK,
};
const POLARITY_LABEL: Record<'positive' | 'neutral' | 'negative', string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
};
const POLARITY_META: Record<'positive' | 'neutral' | 'negative', { label: string; color: string; wash: string; strip: string }> = {
  positive: { label: 'Positive', color: TEAL, wash: WASH.positive, strip: TEAL },
  neutral: { label: 'Neutral', color: RULE_STRONG, wash: WASH.neutral, strip: NAVY_60 },
  negative: { label: 'Negative', color: PINK, wash: WASH.negative, strip: PINK },
};

type GroupKey = 'fix' | 'protect' | 'amplify' | 'watch';
const GROUP_META: Record<GroupKey, { title: string; color: string; blurb: string }> = {
  fix: {
    title: 'Fix first',
    color: PINK,
    blurb: 'Medium volume and up, sentiment under 60% — the loudest damage.',
  },
  protect: {
    title: 'Protect',
    color: TEAL,
    blurb: 'Medium volume and up, sentiment 60% or better — keep the evidence fresh.',
  },
  amplify: {
    title: 'Amplify',
    color: 'rgba(13,188,186,0.35)',
    blurb: 'Positive but low volume — supply more proof points.',
  },
  watch: {
    title: 'Watchlist',
    color: RULE_STRONG,
    blurb: 'Negative but low volume — monitor before it grows.',
  },
};
const GROUP_ORDER: GroupKey[] = ['fix', 'protect', 'amplify', 'watch'];

// Attributes table (CompetitorsTab's "Card 3" pattern).
const TABLE_PAGE_SIZE = 15;
const TOP_SOURCES_PER_ROW = 5;
type TableSortKey = 'name' | 'group' | 'sentiment' | 'visibility' | 'relevance' | 'sources';

const BAND_LABELS: Record<number, string> = {
  5: 'Very high',
  4: 'High',
  3: 'Medium',
  2: 'Low',
  1: 'Very low',
};

const EYEBROW_CLS = 'text-[11px] font-bold uppercase tracking-[0.24em]';
const SMALL_LABEL_CLS = 'text-[11px] font-semibold uppercase tracking-[0.1em]';

// Stable fallbacks for the optional array/object props. Inline `= []` / `= {}`
// defaults mint a fresh identity on every render whenever a prop arrives
// undefined, which would churn every useMemo/effect keyed on them below.
const EMPTY_ARRAY: any[] = [];
const EMPTY_OBJECT: Record<string, string> = {};

export const ThematicAnalysisTab = React.memo(({ responses, companyName, aiThemes, aiThemesLoading, attributeThemes = EMPTY_ARRAY, fetchAIThemesForAttribute, aiThemeAttrsLoaded = EMPTY_ARRAY, onRefreshThemes, responseTexts = EMPTY_OBJECT, fetchResponseTexts, previousPeriodResponses = EMPTY_ARRAY, responsesLoading = false, themesStatus = 'ready', streamError = false, onRetry, selectedJobFunction = 'all', onJobFunctionChange, cubeQuarterKey, cubeMonthFloor = null, cubeScopeRows, cubePromptTypeRows, currentCompanyId, recencyData = EMPTY_ARRAY, recencyDataLoading = false }: ThematicAnalysisTabProps) => {

  // Modal state — persisted so a reload restores the open drilldown.
  // Plain state: restoring an open drilldown on page load opened it before
  // any of its data existed.
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Modal filter: the sentiment split filters quotes and sources together.
  const [polarity, setPolarity] = useState<'positive' | 'neutral' | 'negative' | null>(null);

  // Attributes table — search, filter chips, sort and page.
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGroups, setFilterGroups] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterSources, setFilterSources] = useState<string[]>([]);
  const [filterModels, setFilterModels] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<TableSortKey>('visibility');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [tablePage, setTablePage] = useState(0);

  // A page index only means something for the row set it was chosen on —
  // jump back to page 1 whenever the rows are re-filtered, re-sorted or
  // re-scoped.
  useEffect(() => {
    setTablePage(0);
  }, [searchQuery, filterGroups, filterCategories, filterSources, filterModels, sortKey, sortDir, selectedJobFunction, cubeQuarterKey]);

  // Reset the modal filter whenever a different attribute is opened.
  useEffect(() => {
    setPolarity(null);
  }, [selectedAttribute]);

  // Fetch raw themes for the drilldown's attribute when it opens. Also fires
  // on mount when the persisted modal state restores an open drilldown, and
  // again after a refresh/scope change empties the loaded set. The hook
  // guards re-entrancy, so extra fires are no-ops.
  useEffect(() => {
    if (isModalOpen && selectedAttribute && fetchAIThemesForAttribute &&
        !aiThemeAttrsLoaded.includes(selectedAttribute)) {
      fetchAIThemesForAttribute(selectedAttribute);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, selectedAttribute, aiThemeAttrsLoaded]);

  // The drilldown must not declare "no themes" while its attribute's raw
  // themes are still in flight. "Settled" = the selected attribute's rows are
  // loaded, or loading stopped without them past a short grace period (fetch
  // failure / genuinely theme-less attribute). Derived — NOT plain state —
  // and the grace marker is keyed to the attribute it elapsed for, so
  // switching attributes can never read a stale settled=true.
  const selectedAttributeLoaded = !!selectedAttribute && aiThemeAttrsLoaded.includes(selectedAttribute);
  const [graceElapsedFor, setGraceElapsedFor] = useState<string | null>(null);
  // The grace clock only runs while the drilldown is actually open — a
  // persisted attribute id must not let it elapse in the background and then
  // flash "No themes found" over a fetch that's still in flight.
  useEffect(() => {
    if (isModalOpen) setGraceElapsedFor(null);
  }, [isModalOpen, selectedAttribute]);
  useEffect(() => {
    if (!isModalOpen || !selectedAttribute || selectedAttributeLoaded || aiThemesLoading) return;
    const attr = selectedAttribute;
    const timer = setTimeout(() => setGraceElapsedFor(attr), 4000);
    return () => clearTimeout(timer);
  }, [isModalOpen, selectedAttribute, selectedAttributeLoaded, aiThemesLoading]);
  const themesSettled = selectedAttributeLoaded || (!!selectedAttribute && graceElapsedFor === selectedAttribute);

  const [selectedPromptType] = usePersistedState<'all' | 'experience' | 'competitive'>('thematicTab.selectedPromptType', 'experience');
  // Controlled by the parent Dashboard so the job-function selection is shared
  // across all tabs and never resets on tab switch.
  const selectedJobFunctionFilter = selectedJobFunction;
  const setSelectedJobFunctionFilter = onJobFunctionChange ?? (() => {});

  // Distinct job functions present on the prompts behind these responses.
  // Cube path: from the scope cube (quarter-filtered), so pills appear
  // before the raw stream lands. Raw fallback scans the responses.
  const getUniqueJobFunctions = useMemo(() => {
    const fns = new Set<string>();
    if (cubeScopeRows) {
      for (const r of cubeScopeRows) {
        if (cubeQuarterKey && (!r.response_month || quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey)) continue;
        const fn = (r.job_function_context || '').trim();
        if (fn && (r.total_responses || 0) > 0) fns.add(fn);
      }
      return Array.from(fns).sort();
    }
    responses.forEach(response => {
      const fn = response.confirmed_prompts?.job_function_context?.trim();
      if (fn) fns.add(fn);
    });
    return Array.from(fns).sort();
  }, [cubeScopeRows, cubeQuarterKey, responses]);

  // Filter responses by prompt type (experience by default, excludes discovery)
  // and by the selected job function.
  const filteredResponses = useMemo(() => {
    return responses.filter(response => {
      const promptType = response.confirmed_prompts?.prompt_type;

      const isValidType = promptType === 'experience' ||
                          promptType === 'competitive';

      if (!isValidType) return false;

      if (selectedPromptType !== 'all') {
        if (selectedPromptType === 'experience') {
          if (promptType !== 'experience') return false;
        } else if (selectedPromptType === 'competitive') {
          if (promptType !== 'competitive') return false;
        }
      }

      if (selectedJobFunctionFilter !== 'all' &&
          response.confirmed_prompts?.job_function_context?.trim() !== selectedJobFunctionFilter) {
        return false;
      }

      return true;
    });
  }, [responses, selectedPromptType, selectedJobFunctionFilter]);

  // Does the selection have any analyzable (experience/competitive) responses?
  // Gates the "No Experience Data" empty state. Cube path answers from the
  // prompt-type cube immediately; raw fallback needs the stream.
  const hasScopedData = useMemo(() => {
    if (cubePromptTypeRows) {
      for (const r of cubePromptTypeRows) {
        if (r.prompt_type !== 'experience' && r.prompt_type !== 'competitive') continue;
        if (selectedPromptType !== 'all' && r.prompt_type !== selectedPromptType) continue;
        if (selectedJobFunctionFilter !== 'all' && (r.job_function_context || '').trim() !== selectedJobFunctionFilter) continue;
        if (cubeQuarterKey && (!r.response_month || quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey)) continue;
        if ((r.total_responses || 0) > 0) return true;
      }
      return false;
    }
    return filteredResponses.length > 0;
  }, [cubePromptTypeRows, cubeQuarterKey, selectedPromptType, selectedJobFunctionFilter, filteredResponses]);

  // Normalize every theme's attribute id to the live v2 taxonomy at ingestion:
  // legacy v1 ids (existing clients' historical + still-collecting data) fold
  // into their v2 successor via LEGACY_ATTRIBUTE_MAP; retired/unknown ids drop.
  // Doing this once here keeps every downstream filter and drilldown
  // consistent with the MV-driven views (which also carry legacy rows).
  const normalizedThemes = useMemo(
    () =>
      aiThemes.flatMap(theme => {
        const id = normalizeAttributeId(theme.attribute_id);
        return id ? [theme.attribute_id === id ? theme : { ...theme, attribute_id: id }] : [];
      }),
    [aiThemes]
  );

  // Themes are tied to responses via response_id. Keep only themes whose
  // response belongs to the selected job function (when one is selected).
  const filteredThemes = useMemo(() => {
    let themes = normalizedThemes;
    if (selectedJobFunctionFilter !== 'all') {
      const fnResponseIds = new Set(
        responses
          .filter(r => r.confirmed_prompts?.job_function_context?.trim() === selectedJobFunctionFilter)
          .map(r => r.id)
      );
      themes = themes.filter(t => fnResponseIds.has(t.response_id));
    }
    return themes;
  }, [normalizedThemes, selectedJobFunctionFilter, responses]);

  // Attribute scores built from the pre-aggregated MV (company_attribute_themes_mv)
  // so the tab renders instantly. Scoped to the in-scope responses' (month, job
  // function) — mirroring the old "themes of these responses" semantics at the
  // MV grain. Raw ai_themes are only needed for the per-attribute drilldown.
  const themeData = useMemo(() => {
    if (!attributeThemes || attributeThemes.length === 0) return [] as any[];

    // Explicit cube scoping when wired (cubeQuarterKey !== undefined): keep
    // MV rows whose response_month falls in the active quarter (null = all
    // periods) and whose function matches the pill. No raw-stream
    // dependency, so the tab paints final numbers before the stream lands.
    const cubeMode = cubeQuarterKey !== undefined;

    const scopedResponses = cubeMode ? [] : (selectedJobFunctionFilter === 'all'
      ? responses
      : responses.filter(r => r.confirmed_prompts?.job_function_context?.trim() === selectedJobFunctionFilter));

    // Legacy scoping: keys stay at the MV's month grain — a quarterly period
    // simply contributes every month key it contains. Responses key on their
    // own response_month (the collection-cycle month) so they match the MV's
    // bucketing exactly. tested_at is only a legacy fallback.
    const monthOf = (r: any): string => {
      if (r.response_month) return String(r.response_month).slice(0, 7);
      const d = new Date(r.tested_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const keys = new Set(scopedResponses.map(r => `${monthOf(r)}|${(r.confirmed_prompts?.job_function_context || '').trim()}`));
    const rowKey = (row: any) => `${String(row.response_month).slice(0, 7)}|${(row.job_function_context || '').trim()}`;
    const scope = keys.size > 0;

    const rowInScope = (row: any): boolean => {
      if (cubeMode) {
        if (selectedJobFunctionFilter !== 'all' && (row.job_function_context || '').trim() !== selectedJobFunctionFilter) return false;
        if (cubeQuarterKey) {
          if (!row.response_month || quarterKeyOfMonthStr(String(row.response_month)) !== cubeQuarterKey) return false;
        } else if (cubeMonthFloor && row.response_month && String(row.response_month).slice(0, 7) < cubeMonthFloor) {
          // Quarter bypassed: clamp to the raw stream's window so these
          // scores match the stream-fed drilldowns.
          return false;
        }
        return true;
      }
      return !scope || keys.has(rowKey(row));
    };

    const agg: Record<string, { positive: number; negative: number; neutral: number; responses: number }> = {};
    attributeThemes.forEach(row => {
      if (!rowInScope(row)) return;
      // The MV deliberately carries legacy v1 attribute rows for existing
      // clients; fold them into their v2 successor so one attribute never
      // appears as two rows (and retired ids don't render as raw slugs).
      const attrId = normalizeAttributeId(row.attribute_id);
      if (!attrId) return;
      if (!agg[attrId]) agg[attrId] = { positive: 0, negative: 0, neutral: 0, responses: 0 };
      const a = agg[attrId];
      a.positive += Number(row.positive_themes) || 0;
      a.negative += Number(row.negative_themes) || 0;
      a.neutral += Number(row.neutral_themes) || 0;
      a.responses += Number(row.response_count) || 0; // each response is in exactly one (month, fn) cell
    });

    const attrName = (id: string) => ATTRIBUTES.find(x => x.id === id)?.name || id;

    return Object.entries(agg)
      .map(([id, a]) => {
        // Methodology v2: positive/(positive+negative); neutrals stay in the
        // composition counts but not in the score.
        const sentimentRatio = sentimentRatioV2(a.positive, a.negative) ?? 0;
        return {
          id,
          name: attrName(id),
          count: a.responses,
          sentimentRatio,
          positiveCount: a.positive,
          negativeCount: a.negative,
          neutralCount: a.neutral,
        };
      })
      .filter(a => (a.positiveCount + a.negativeCount + a.neutralCount) > 0)
      .sort((a, b) => b.count - a.count);
  }, [attributeThemes, responses, selectedJobFunctionFilter, cubeQuarterKey, cubeMonthFloor]);

  // Volume bands are relative to this company's own distribution (quintiles of
  // response counts), same as the previous ranking's pills.
  const volumeThresholds = useMemo(() => {
    if (themeData.length === 0) return { p20: 0, p40: 0, p60: 0, p80: 0 };
    const sorted = [...themeData.map(t => t.count)].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
      return sorted[idx];
    };
    return { p20: percentile(20), p40: percentile(40), p60: percentile(60), p80: percentile(80) };
  }, [themeData]);

  const volumeBand = (count: number) => {
    if (count > volumeThresholds.p80) return 5;
    if (count > volumeThresholds.p60) return 4;
    if (count > volumeThresholds.p40) return 3;
    if (count > volumeThresholds.p20) return 2;
    return 1;
  };

  // Enriched attribute list shared by the matrix, the cards, the rail and the
  // modal header. Grouping rule (identical everywhere): loud = volume band ≥
  // Medium; positive = sentiment ≥ 60%.
  const attributes = useMemo(() => {
    return themeData.map(a => {
      const sentimentPct = Math.round(a.sentimentRatio * 100);
      const band = volumeBand(a.count);
      const loud = band >= 3;
      const positive = sentimentPct >= 60;
      const group: GroupKey = loud ? (positive ? 'protect' : 'fix') : (positive ? 'amplify' : 'watch');
      return {
        ...a,
        sentimentPct,
        band,
        bandLabel: BAND_LABELS[band],
        color: sentimentColor(sentimentPct),
        group,
      };
    });
    // volumeBand depends only on volumeThresholds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeData, volumeThresholds]);

  const groups = useMemo(() =>
    GROUP_ORDER.map(key => ({
      key,
      ...GROUP_META[key],
      items: attributes
        .filter(a => a.group === key)
        .sort((a, b) => key === 'fix' || key === 'watch'
          ? a.sentimentPct - b.sentimentPct
          : b.sentimentPct - a.sentimentPct),
    })),
  [attributes]);

  // ---- Attributes table derivations ----------------------------------------

  // Raw responses in scope for the table's stream-fed columns: the current
  // period's stream narrowed to the job-function pill. Deliberately NOT
  // prompt-type filtered — the MV behind sentiment/visibility isn't either.
  const streamInScope = useMemo(
    () => selectedJobFunctionFilter === 'all'
      ? responses
      : responses.filter(r => r.confirmed_prompts?.job_function_context?.trim() === selectedJobFunctionFilter),
    [responses, selectedJobFunctionFilter]
  );

  // Visibility denominator: every in-scope answer (all prompt types). From
  // the scope cube when wired — the same "% of answers" denominator the MCP
  // tools use (scope_stats total_responses) — else the scoped raw stream.
  const totalScopedAnswers = useMemo(() => {
    if (cubeQuarterKey !== undefined && cubeScopeRows) {
      let total = 0;
      for (const r of cubeScopeRows) {
        if (selectedJobFunctionFilter !== 'all' && (r.job_function_context || '').trim() !== selectedJobFunctionFilter) continue;
        if (cubeQuarterKey) {
          if (!r.response_month || quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey) continue;
        } else if (cubeMonthFloor && r.response_month && String(r.response_month).slice(0, 7) < cubeMonthFloor) {
          continue;
        }
        total += Number(r.total_responses) || 0;
      }
      return total;
    }
    return streamInScope.length;
  }, [cubeQuarterKey, cubeScopeRows, cubeMonthFloor, selectedJobFunctionFilter, streamInScope]);

  // Stream-fed extras per attribute — cited domains, AI models and citation
  // freshness — keyed by the PROMPT's attribute (confirmed_prompts.attribute_id,
  // with legacy prompt_theme names folded in): the same response → attribute
  // link the Sources tab uses for its attributes column. Citations parse once
  // per response. Relevance is the mean url_recency_cache score (0–100) of the
  // cited URLs, matched exactly as the Overview scorecard's fallback does.
  const attributeExtras = useMemo(() => {
    const recencyByUrl = new Map<string, number>();
    for (const item of recencyData) {
      const score = Number(item?.recency_score);
      if (item?.url && Number.isFinite(score)) recencyByUrl.set(item.url, score);
    }
    const out = new Map<string, {
      domainCounts: Map<string, number>; // domain → responses citing it
      models: Set<string>;
      recencySum: number;
      recencyN: number;
    }>();
    for (const r of streamInScope) {
      const cp: any = r.confirmed_prompts;
      const attrId = normalizeAttributeId(cp?.attribute_id) ?? getAttributeIdByName(cp?.prompt_theme);
      if (!attrId || isExcludedAiModel(r.ai_model, r.response_month)) continue;
      let agg = out.get(attrId);
      if (!agg) {
        agg = { domainCounts: new Map(), models: new Set(), recencySum: 0, recencyN: 0 };
        out.set(attrId, agg);
      }
      if (r.ai_model) agg.models.add(getLLMDisplayName(r.ai_model));
      let parsed: any = r.citations;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      if (!Array.isArray(parsed)) continue;
      const seen = new Set<string>();
      for (const c of enhanceCitations(parsed)) {
        if (c.type !== 'website' || !c.domain) continue;
        const d = c.domain.trim().toLowerCase().replace(/^www\./, '');
        if (d && !seen.has(d)) {
          seen.add(d);
          agg.domainCounts.set(d, (agg.domainCounts.get(d) || 0) + 1);
        }
        if (c.url) {
          const score = recencyByUrl.get(extractSourceUrl(c.url));
          if (score !== undefined) {
            agg.recencySum += score;
            agg.recencyN += 1;
          }
        }
      }
    }
    return out;
  }, [streamInScope, recencyData]);

  type AttributeTableRow = {
    id: string;
    name: string;
    category: string;
    group: GroupKey;
    sentimentPct: number;
    color: string;
    visibilityPct: number | null;
    relevance: number | null;
    /** Top cited domains (the stack). */
    sources: string[];
    /** Every cited domain (the Sources filter). */
    domains: string[];
    sourceCount: number;
    models: string[];
  };

  const allTableRows = useMemo((): AttributeTableRow[] => attributes.map(a => {
    const extras = attributeExtras.get(a.id);
    const domainsRanked = extras
      ? Array.from(extras.domainCounts.entries())
          .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
          .map(([domain]) => domain)
      : [];
    return {
      id: a.id,
      name: a.name,
      category: ATTRIBUTES.find(x => x.id === a.id)?.category ?? 'Other',
      group: a.group,
      sentimentPct: a.sentimentPct,
      color: a.color,
      visibilityPct: totalScopedAnswers > 0 ? Math.min(100, (a.count / totalScopedAnswers) * 100) : null,
      relevance: extras && extras.recencyN > 0 ? Math.round(extras.recencySum / extras.recencyN) : null,
      sources: domainsRanked.slice(0, TOP_SOURCES_PER_ROW),
      domains: domainsRanked,
      sourceCount: domainsRanked.length,
      models: extras ? Array.from(extras.models).sort() : [],
    };
  }), [attributes, attributeExtras, totalScopedAnswers]);

  const filteredTableRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const groupFilter = new Set(filterGroups);
    const categoryFilter = new Set(filterCategories);
    const sourceFilter = new Set(filterSources);
    const modelFilter = new Set(filterModels);
    const rows = allTableRows.filter(row => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (groupFilter.size > 0 && !groupFilter.has(row.group)) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(row.category)) return false;
      if (sourceFilter.size > 0 && !row.domains.some(d => sourceFilter.has(d))) return false;
      if (modelFilter.size > 0 && !row.models.some(m => modelFilter.has(m))) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    // Unavailable metrics (null) sort after every real value in both directions.
    const num = (a: number | null, b: number | null) =>
      a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : dir * (a - b);
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.name.localeCompare(b.name);
        // Ranked so the default (desc) click reads in GROUP_ORDER: Fix first → Watchlist.
        case 'group': return dir * (GROUP_ORDER.indexOf(b.group) - GROUP_ORDER.indexOf(a.group)) || a.name.localeCompare(b.name);
        case 'sentiment': return dir * (a.sentimentPct - b.sentimentPct);
        case 'relevance': return num(a.relevance, b.relevance);
        case 'sources': return dir * (a.sourceCount - b.sourceCount);
        default: return num(a.visibilityPct, b.visibilityPct) || dir * (a.sentimentPct - b.sentimentPct);
      }
    });
  }, [allTableRows, searchQuery, filterGroups, filterCategories, filterSources, filterModels, sortKey, sortDir]);

  const tableFilterOptions = useMemo(() => {
    const groupCounts = new Map<GroupKey, number>();
    const categoryCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    for (const row of allTableRows) {
      groupCounts.set(row.group, (groupCounts.get(row.group) || 0) + 1);
      categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);
      row.domains.forEach(d => sourceCounts.set(d, (sourceCounts.get(d) || 0) + 1));
      row.models.forEach(m => modelCounts.set(m, (modelCounts.get(m) || 0) + 1));
    }
    const byCountDesc = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
    return {
      groups: GROUP_ORDER
        .filter(g => groupCounts.has(g))
        .map(g => ({
          value: g,
          label: GROUP_META[g].title,
          count: groupCounts.get(g),
          adornment: <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: GROUP_META[g].color }} />,
        })),
      categories: Array.from(categoryCounts.entries())
        .sort(byCountDesc)
        .map(([value, count]) => ({ value, label: value, count })),
      sources: Array.from(sourceCounts.entries())
        .sort(byCountDesc)
        .map(([value, count]) => ({
          value,
          label: value,
          count,
          adornment: <Favicon domain={value} size="sm" />,
        })),
      models: Array.from(modelCounts.entries())
        .sort(byCountDesc)
        .map(([value, count]) => ({
          value,
          label: value,
          count,
          adornment: <LLMLogo modelName={value} size="sm" showFallback={false} />,
        })),
    };
  }, [allTableRows]);

  const activeFilterCount =
    filterGroups.length + filterCategories.length + filterSources.length + filterModels.length;

  const clearAllFilters = () => {
    setFilterGroups([]);
    setFilterCategories([]);
    setFilterSources([]);
    setFilterModels([]);
  };

  const toggleSort = (key: TableSortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  // The MV-fed columns (sentiment, visibility, group) are final as soon as the
  // attribute rows exist; only the stream-fed extras (sources, models,
  // relevance) and the competitor triples lag behind, so those cells show
  // their own pending state while the raw stream is still arriving.
  const rawExtrasPending = responsesLoading;

  // Matrix marker placement. x = sentiment%, y = volume band center. Labels
  // sit to the right of the dot by default; to keep names from overprinting
  // (or clipping at the plot edge) each marker picks, in order of preference,
  // a side (right/left of the dot) and a small vertical nudge such that its
  // estimated label extent overlaps nothing already placed in its band.
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(900);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setPlotWidth(w => el.clientWidth || w);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [attributes.length]);

  const plotMarkers = useMemo(() => {
    // Label extent in % of plot width: ~7.6px/char at 13px/600 + dot, icon & gaps.
    const estWidth = (name: string) => ((name.length * 7.6 + 48) / Math.max(plotWidth, 400)) * 100;
    const byBand = new Map<number, typeof attributes>();
    attributes.forEach(a => {
      const list = byBand.get(a.band) ?? [];
      list.push(a);
      byBand.set(a.band, list);
    });
    const markers: (typeof attributes[number] & { flip: boolean; nudge: number })[] = [];
    byBand.forEach(list => {
      const sorted = [...list].sort((a, b) => a.sentimentPct - b.sentimentPct);
      const placed: { lo: number; hi: number; nudge: number }[] = [];
      sorted.forEach(a => {
        const x = Math.min(98, Math.max(2, a.sentimentPct));
        const w = estWidth(a.name);
        const rightIv = { lo: x - 1, hi: x + w };
        const leftIv = { lo: x - w, hi: x + 1 };
        const collides = (iv: { lo: number; hi: number }, nudge: number) =>
          placed.some(p => p.nudge === nudge && iv.lo < p.hi && p.lo < iv.hi);
        let chosen: { flip: boolean; nudge: number } | null = null;
        for (const nudge of [0, -26, 26]) {
          for (const flip of [false, true]) {
            const iv = flip ? leftIv : rightIv;
            const fits = flip ? iv.lo >= 1 : iv.hi <= 99;
            if (fits && !collides(iv, nudge)) {
              chosen = { flip, nudge };
              break;
            }
          }
          if (chosen) break;
        }
        if (!chosen) chosen = { flip: rightIv.hi > 99 && leftIv.lo >= 1, nudge: 26 };
        placed.push({ ...(chosen.flip ? leftIv : rightIv), nudge: chosen.nudge });
        markers.push({ ...a, flip: chosen.flip, nudge: chosen.nudge });
      });
    });
    return markers;
  }, [attributes, plotWidth]);

  const openAttribute = (id: string) => {
    setSelectedAttribute(id);
    setIsModalOpen(true);
  };

  // Let the global command palette jump straight to an attribute's drilldown
  // (there is no search box in this tab anymore).
  useTabSearchSeed('thematic', (q) => {
    const query = q.trim().toLowerCase();
    if (!query) return;
    const match = attributes.find(a => a.name.toLowerCase().includes(query));
    if (match) openAttribute(match.id);
  });

  // ---- Modal derivations ---------------------------------------------------

  const modalAttribute = selectedAttribute
    ? attributes.find(a => a.id === selectedAttribute) ?? null
    : null;

  // Raw themes for the open attribute — quote/source attribution. Gated on
  // the modal actually being open: selectedAttribute persists across sessions,
  // and these derivations walk every theme row (and parse citations), so they
  // must not re-run on every scope change while the drilldown is closed.
  const attrThemes = useMemo(
    () => (isModalOpen && selectedAttribute ? filteredThemes.filter(t => t.attribute_id === selectedAttribute) : []),
    [filteredThemes, selectedAttribute, isModalOpen]
  );

  // Drilldown detail (quotes + sources), loaded straight from the database for
  // the attribute's most recent answers. The modal used to join themes against
  // the in-memory response stream, which is scoped to the active period and
  // often still loading, so quotes and sources came up empty. This is one
  // small, bounded fetch per open and never depends on the stream.
  const DETAIL_SAMPLE = 150;
  const QUOTE_TEXT_SAMPLE = 30;
  const QUOTE_LIMIT = 8;
  type DetailRow = {
    id: string;
    model: string | null;
    domains: string[];
    // Pages the answer cited (answer-level: the AI does not tie a citation
    // to a sentence, so these are "cited in this answer", never proof of
    // where one excerpt came from).
    cites: { domain: string; url: string }[];
    market: string | null;
    jobFunction: string | null;
    text: string;
  };
  // Per theme: the verbatim snippets the classifier stored as evidence, and
  // its keywords. The keyset RPC leaves these heavy columns out, so they are
  // read here for the sampled answers only.
  type ThemeEvidence = { snippets: string[]; keywords: string[] };
  const [detail, setDetail] = useState<{ key: string; status: 'loading' | 'ready' | 'error'; rows: DetailRow[]; evidence: Map<string, ThemeEvidence> } | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

  // Most recent answers first (by their newest theme row for this attribute).
  const sampleIds = useMemo(() => {
    const latest = new Map<string, string>();
    attrThemes.forEach(t => {
      const prev = latest.get(t.response_id);
      if (prev === undefined || (t.created_at || '') > prev) latest.set(t.response_id, t.created_at || '');
    });
    return [...latest.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, DETAIL_SAMPLE)
      .map(([id]) => id);
  }, [attrThemes]);
  const detailKey = isModalOpen && selectedAttribute && sampleIds.length > 0
    ? `${selectedAttribute}|${sampleIds.length}|${sampleIds[0]}|${detailRetry}`
    : '';

  useEffect(() => {
    if (!detailKey) return;
    let cancelled = false;
    setDetail({ key: detailKey, status: 'loading', rows: [], evidence: new Map() });
    (async () => {
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < sampleIds.length; i += 50) chunks.push(sampleIds.slice(i, i + 50));
        const textIds = sampleIds.slice(0, QUOTE_TEXT_SAMPLE);
        const sampled = new Set(sampleIds);
        const themeIds = attrThemes.filter(t => sampled.has(t.response_id)).map(t => t.id);
        const themeChunks: string[][] = [];
        for (let i = 0; i < themeIds.length; i += 100) themeChunks.push(themeIds.slice(i, i + 100));
        const [metaResults, textResult, evidenceResults] = await Promise.all([
          Promise.all(chunks.map(chunk =>
            (supabase as any)
              .from('prompt_responses')
              .select('id, ai_model, citations, confirmed_prompts(location_context, job_function_context)')
              .in('id', chunk)
          )),
          (supabase as any)
            .from('prompt_responses')
            .select('id, response_text')
            .in('id', textIds),
          Promise.all(themeChunks.map(chunk =>
            (supabase as any)
              .from('ai_themes')
              .select('id, context_snippets, keywords')
              .in('id', chunk)
          )),
        ]);
        if (cancelled) return;
        const failed = [...metaResults, textResult].find((r: any) => r.error);
        if (failed) throw failed.error;

        // Evidence is an enhancement: if it fails, quotes fall back to
        // excerpts cut from the answer text.
        const evidence = new Map<string, ThemeEvidence>();
        evidenceResults.forEach((res: any) => {
          if (res.error) { console.warn('Theme evidence fetch failed:', res.error); return; }
          (res.data ?? []).forEach((t: any) => evidence.set(t.id, {
            snippets: (Array.isArray(t.context_snippets) ? t.context_snippets : [])
              .map((s: unknown) => String(s ?? '').trim())
              .filter(Boolean),
            keywords: Array.isArray(t.keywords) ? t.keywords.filter(Boolean) : [],
          }));
        });

        const texts = new Map<string, string>();
        (textResult.data ?? []).forEach((r: any) => texts.set(r.id, r.response_text || ''));
        const byId = new Map<string, DetailRow>();
        metaResults.forEach((res: any) => (res.data ?? []).forEach((r: any) => {
          let domains: string[] = [];
          const cites: { domain: string; url: string }[] = [];
          try {
            const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
            if (Array.isArray(citations)) {
              citations.forEach((c: any) => {
                // Fold www. into the bare domain so one source never shows twice.
                const domain = c?.domain ? String(c.domain).replace(/^www\./, '') : null;
                if (!domain || domains.includes(domain)) return;
                domains.push(domain);
                const url = typeof c?.url === 'string' && /^https?:\/\//.test(c.url) ? c.url : `https://${domain}`;
                cites.push({ domain, url });
              });
            }
          } catch { /* skip invalid citations */ }
          byId.set(r.id, {
            id: r.id,
            model: r.ai_model ?? null,
            domains,
            cites,
            market: r.confirmed_prompts?.location_context ?? null,
            jobFunction: r.confirmed_prompts?.job_function_context?.trim() || null,
            text: texts.get(r.id) || responseTexts[r.id] || '',
          });
        }));
        const rows = sampleIds.map(id => byId.get(id)).filter(Boolean) as DetailRow[];
        setDetail({ key: detailKey, status: 'ready', rows, evidence });
      } catch (err) {
        if (cancelled) return;
        console.warn('Attribute detail fetch failed:', err);
        setDetail({ key: detailKey, status: 'error', rows: [], evidence: new Map() });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey]);

  const detailStatus: 'loading' | 'ready' | 'error' =
    detail && detail.key === detailKey ? detail.status : 'loading';
  const detailRows = detail && detail.key === detailKey ? detail.rows : [];
  const themeEvidence = detail && detail.key === detailKey ? detail.evidence : null;

  // Polarities this attribute carries in each answer, so the sentiment split
  // filters quotes and sources together.
  const polaritiesByResponse = useMemo(() => {
    const map = new Map<string, Set<string>>();
    attrThemes.forEach(t => {
      const set = map.get(t.response_id) ?? new Set<string>();
      set.add(t.sentiment);
      map.set(t.response_id, set);
    });
    return map;
  }, [attrThemes]);

  // Quotes. Each theme stores 1-2 verbatim snippets from its answer as
  // evidence; those lead the card, under the theme's own name and sentiment.
  // "Read in context" shows the wider passage around the first snippet when
  // the answer text is loaded. Answers whose themes carry no snippets fall
  // back to an excerpt anchored on a keyword or the theme name.
  const quotes = useMemo(() => {
    const themesByResponse = new Map<string, AITheme[]>();
    attrThemes.forEach(t => {
      const list = themesByResponse.get(t.response_id) ?? [];
      list.push(t);
      themesByResponse.set(t.response_id, list);
    });
    // Strip markdown noise so quotes read as prose ("**", "###",
    // and the known "• undefined:" data artifact).
    const clean = (s: string) => s
      .replace(/•\s*undefined:\s*/g, '• ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\s#{1,6}\s+/g, ' ')
      .replace(/\*\*/g, '');
    // Window of the answer around the first needle found, snapped to a
    // sentence start (else a word) and a word end so it never opens or
    // closes mid-word. Null when no needle is in the text.
    const excerptAround = (text: string, needles: string[], fallbackToStart: boolean): string | null => {
      const lower = text.toLowerCase();
      let idx = -1;
      for (const n of needles) {
        const i = lower.indexOf(n.toLowerCase());
        if (i !== -1 && (idx === -1 || i < idx)) idx = i;
      }
      if (idx === -1 && !fallbackToStart) return null;
      const anchor = Math.max(idx, 0);
      let start = Math.max(0, anchor - 120);
      if (start > 0) {
        const lead = text.slice(start, anchor);
        const sentenceEnd = Math.max(lead.lastIndexOf('. '), lead.lastIndexOf('! '), lead.lastIndexOf('? '), lead.lastIndexOf('\n'));
        const firstSpace = lead.indexOf(' ');
        if (sentenceEnd !== -1) start += sentenceEnd + 1;
        else if (firstSpace !== -1) start += firstSpace + 1;
      }
      let end = Math.min(text.length, anchor + 560);
      if (end < text.length) {
        const space = text.lastIndexOf(' ', end);
        if (space > anchor) end = space;
      }
      const excerpt = text.slice(start, end).trim().replace(/^[\s.,;:!?)]+/, '');
      if (!excerpt) return null;
      return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`;
    };

    const out: {
      id: string;
      responseId: string;
      themeName: string | null;
      text: string;
      context: string | null;
      model: string | null;
      market: string | null;
      jobFunction: string | null;
      cites: { domain: string; url: string }[];
      polarity: 'positive' | 'neutral' | 'negative';
    }[] = [];
    for (const r of detailRows) {
      const text = clean(r.text);
      const rThemes = themesByResponse.get(r.id) ?? [];
      const meta = { responseId: r.id, model: r.model, market: r.market, jobFunction: r.jobFunction, cites: r.cites.slice(0, 4) };
      let hadEvidence = false;
      for (const t of rThemes) {
        const ev = themeEvidence?.get(t.id);
        const snippets = (ev?.snippets ?? []).map(clean).map(s => s.trim()).filter(Boolean);
        if (snippets.length === 0) continue;
        hadEvidence = true;
        const context = text.trim() ? excerptAround(text, [snippets[0], ...(ev?.keywords ?? [])], false) : null;
        out.push({
          ...meta,
          id: t.id,
          themeName: t.theme_name || null,
          text: snippets.join(' … '),
          context,
          polarity: (t.sentiment || 'neutral') as 'positive' | 'neutral' | 'negative',
        });
      }
      if (hadEvidence || !text.trim()) continue;
      // Fallback: no stored snippets for this answer's themes.
      let matched: AITheme | null = null;
      let best = -1;
      for (const t of rThemes) {
        const needles = [...(themeEvidence?.get(t.id)?.keywords ?? []), t.theme_name].filter(Boolean);
        for (const n of needles) {
          const i = text.toLowerCase().indexOf(String(n).toLowerCase());
          if (i !== -1 && (best === -1 || i < best)) { best = i; matched = t; }
        }
      }
      const excerpt = excerptAround(text, matched ? [...(themeEvidence?.get(matched.id)?.keywords ?? []), matched.theme_name] : [], true);
      if (!excerpt) continue;
      out.push({
        ...meta,
        id: r.id,
        themeName: matched?.theme_name || null,
        text: excerpt,
        context: null,
        polarity: (matched?.sentiment || rThemes[0]?.sentiment || 'neutral') as 'positive' | 'neutral' | 'negative',
      });
    }
    return out;
  }, [detailRows, attrThemes, themeEvidence]);

  // Sources cited, as coverage: the share of the sampled answers (within the
  // sentiment filter) that cite each domain.
  const sourceCoverage = useMemo(() => {
    const inFilter = detailRows.filter(r => !polarity || polaritiesByResponse.get(r.id)?.has(polarity));
    const counts = new Map<string, number>();
    inFilter.forEach(r => r.domains.forEach(d => counts.set(d, (counts.get(d) ?? 0) + 1)));
    return {
      base: inFilter.length,
      rows: [...counts.entries()]
        .map(([domain, n]) => ({ domain, pct: inFilter.length ? Math.round((n / inFilter.length) * 100) : 0 }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8),
    };
  }, [detailRows, polarity, polaritiesByResponse]);
  const visibleQuotes = useMemo(
    () => {
      // One card per answer so a single long answer can't fill the list.
      const seen = new Set<string>();
      return quotes
        .filter(q => !polarity || q.polarity === polarity)
        .filter(q => (seen.has(q.responseId) ? false : (seen.add(q.responseId), true)))
        .slice(0, QUOTE_LIMIT);
    },
    [quotes, polarity]
  );

  const closeModal = () => {
    setIsModalOpen(false);
    setPolarity(null);
  };

  const togglePolarity = (key: 'positive' | 'neutral' | 'negative') => {
    setPolarity(prev => (prev === key ? null : key));
  };

  // Per-quote "Read full excerpt" state; resets with the attribute.
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  useEffect(() => { setExpandedQuotes({}); }, [selectedAttribute]);

  const SortableHead = ({ label, k, className }: { label: string; k: TableSortKey; className?: string }) => (
    <TableHead
      className={`cursor-pointer select-none hover:text-gray-900 ${className ?? ''}`}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && <span className="text-[10px] text-gray-400">{sortDir === 'desc' ? '▼' : '▲'}</span>}
      </span>
    </TableHead>
  );

  const pendingCell = <span className="inline-block h-4 w-14 rounded bg-gray-100 animate-pulse" aria-busy="true" />;
  const emptyCell = <span className="text-xs text-gray-400">—</span>;

  // Modal header + split counts come from the MV (instant); themes/sources/
  // quotes come from the raw rows (lazy-loaded on open).
  const splitCounts = modalAttribute
    ? [
        { key: 'positive' as const, n: modalAttribute.positiveCount },
        { key: 'neutral' as const, n: modalAttribute.neutralCount },
        { key: 'negative' as const, n: modalAttribute.negativeCount },
      ]
    : [];
  const splitTotal = splitCounts.reduce((a, s) => a + s.n, 0);

  const infoTip = (text: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help" aria-label="What is this?">
          <Info className="w-[15px] h-[15px]" style={{ color: INK_DIM }} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );

  const attributeCard = (a: typeof attributes[number]) => {
    const IconComponent = ATTRIBUTE_ICONS[a.id] || Activity;
    return (
      <button
        key={a.id}
        onClick={() => openAttribute(a.id)}
        className="w-full text-left rounded-[14px] border p-4 pb-3.5 flex flex-col gap-3 transition-colors hover:border-[rgba(19,39,79,0.28)]"
        style={{ borderColor: RULE, background: CARD_FILL }}
      >
        <div className="flex items-start justify-between gap-2.5">
          <span className="flex items-start gap-2 min-w-0 text-[15px] font-semibold leading-tight" style={{ color: INK }}>
            <IconComponent className="w-[17px] h-[17px] flex-none mt-px" style={{ color: a.color }} />
            <span className="min-w-0" style={{ hyphens: 'auto', overflowWrap: 'break-word' }} lang="en">{a.name}</span>
          </span>
          <span className="font-headline text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums flex-none" style={{ color: INK }}>
            {a.sentimentPct}%
          </span>
        </div>
        <div className="h-2 rounded-lg overflow-hidden" style={{ background: BAR_TRACK }}>
          <div className="h-full rounded-lg" style={{ width: `${a.sentimentPct}%`, background: a.color }} />
        </div>
        <span
          className={`${SMALL_LABEL_CLS} self-start rounded-lg border bg-white px-2 py-[3px]`}
          style={{ color: INK_MUTED, borderColor: RULE }}
        >
          {a.bandLabel} volume
        </span>
      </button>
    );
  };

  return (
    <div className="w-full space-y-6">
      {/* Main Section Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1" data-tour="themes-heading">
            <h2 className="font-headline text-[28px] font-semibold tracking-[-0.02em]" style={{ color: INK }}>Thematic Analysis</h2>
            <p style={{ color: INK_MUTED }} className="text-sm">
              Analyze themes and sentiment patterns to understand {companyName}'s employer brand perception.
            </p>
          </div>
        </div>
        {/* Job function filter lives in the top bar (DashboardHeader). */}
      </div>

      {/* No Data Message — skeleton while the raw stream is still arriving */}
      {!hasScopedData && (
        streamError && !cubePromptTypeRows ? (
          <Card>
            <CardContent className="p-6">
              <DataUnavailable
                title="Couldn't load responses."
                description="The response data behind this analysis didn't load. Retry to fetch it again."
                onRetry={onRetry}
              />
            </CardContent>
          </Card>
        ) : responsesLoading ? (
          <Card>
            <CardContent className="p-6" aria-busy="true">
              {/* Plot-shaped placeholder so the loading state matches the quadrant. */}
              <div
                className="relative rounded-2xl bg-gray-50 animate-pulse overflow-hidden"
                style={{ height: 'clamp(320px, calc(100vh - 345px), 520px)' }}
              >
                <div className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: '60%' }} />
                <div className="absolute left-0 right-0 h-px bg-gray-200" style={{ top: '60%' }} />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Experience Data</h3>
                <p className="text-gray-600">
                  You need responses from experience prompts to run thematic analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* Theme family failed: explicit error + Retry, never the empty copy. */}
      {themesStatus === 'error' && themeData.length === 0 && (
        <Card>
          <CardContent className="p-6">
            <DataUnavailable title="Couldn't load themes." onRetry={onRetry} />
          </CardContent>
        </Card>
      )}

      {/* Empty State — only after the theme family and raw themes have loaded */}
      {themesStatus === 'ready' && !aiThemesLoading && themeData.length === 0 && hasScopedData && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Themes Found</h3>
              <p className="text-gray-600">
                No themes have been identified yet. Try running the AI analysis.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attribute views — SWOT matrix / Cards */}
      {attributes.length > 0 && (
        <div
          className="rounded-[20px] border bg-white overflow-hidden"
          style={{ borderColor: RULE }}
          data-tour="themes-chart"
        >
          {/* SWOT matrix — desktop only; mobile gets the card columns below. */}
            <div className="hidden md:flex gap-6 px-7 pt-4 pb-5 overflow-x-auto">
              {/* Plot + axis labels */}
              <div className="flex-1 flex gap-3.5 min-w-[640px]">
                {/* Y axis — same treatment as the sentiment axis, rotated onto the line. */}
                <div
                  className="flex flex-col justify-between items-center w-5 flex-none"
                  style={{ padding: '2px 0 26px' }}
                >
                  <span className="text-[11px] rotate-180" style={{ color: INK_DIM, writingMode: 'vertical-rl' }}>Very high</span>
                  <span className={`${SMALL_LABEL_CLS} rotate-180 whitespace-nowrap`} style={{ color: INK_DIM, writingMode: 'vertical-rl' }}>Volume →</span>
                  <span className="text-[11px] rotate-180" style={{ color: INK_DIM, writingMode: 'vertical-rl' }}>Very low</span>
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <div
                    ref={plotRef}
                    className="relative rounded-2xl border overflow-hidden"
                    style={{ borderColor: RULE, height: 'clamp(320px, calc(100vh - 345px), 520px)' }}
                    data-tour="themes-first-row"
                  >
                    {/* Quadrant tints */}
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: '60% 40%', gridTemplateRows: '60% 40%' }}>
                      <div style={{ background: 'rgba(219,94,137,0.05)' }} />
                      <div style={{ background: 'rgba(13,188,186,0.07)' }} />
                      <div style={{ background: 'rgba(19,39,79,0.025)' }} />
                      <div style={{ background: 'rgba(13,188,186,0.03)' }} />
                    </div>
                    <div className="absolute top-0 bottom-0 w-px" style={{ left: '60%', background: RULE_STRONG }} />
                    <div className="absolute left-0 right-0 h-px" style={{ top: '60%', background: RULE_STRONG }} />
                    {/* Quadrant labels */}
                    <span className="absolute left-[18px] top-4 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: PINK }}>Fix first</span>
                    <span className="absolute right-[18px] top-4 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#0A9A98' }}>Protect</span>
                    <span className="absolute left-[18px] bottom-3.5 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: INK_DIM }}>Watchlist</span>
                    <span className="absolute right-[18px] bottom-3.5 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: INK_DIM }}>Amplify</span>
                    {/* Markers */}
                    {plotMarkers.map(a => {
                      const MarkerIcon = ATTRIBUTE_ICONS[a.id] || Activity;
                      return (
                        <button
                          key={a.id}
                          onClick={() => openAttribute(a.id)}
                          aria-label={`${a.name} — ${a.sentimentPct}% sentiment, ${a.bandLabel} volume`}
                          className="absolute flex items-center gap-2 cursor-pointer group bg-transparent border-0 p-0"
                          style={{
                            left: `${Math.min(98, Math.max(2, a.sentimentPct))}%`,
                            bottom: `calc(${(((a.band - 0.5) / 5) * 100).toFixed(1)}% + ${a.nudge}px)`,
                            transform: a.flip ? 'translate(calc(-100% + 7px), 50%)' : 'translate(-7px, 50%)',
                            flexDirection: a.flip ? 'row-reverse' : 'row',
                          }}
                        >
                          <span className="w-3.5 h-3.5 rounded-full flex-none" style={{ background: a.color }} />
                          <span className={`whitespace-nowrap ${a.flip ? 'text-right' : 'text-left'}`}>
                            <span className={`flex items-center gap-1.5 text-[13px] font-semibold leading-tight group-hover:underline ${a.flip ? 'justify-end' : ''}`} style={{ color: INK }}>
                              <MarkerIcon className="w-[13px] h-[13px] flex-none" style={{ color: INK_MUTED }} />
                              {a.name}
                            </span>
                            <span className="block text-[11px] tabular-nums" style={{ color: INK_MUTED }}>{a.sentimentPct}%</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-between px-1">
                    <span className="text-[11px]" style={{ color: INK_DIM }}>0%</span>
                    <span className={SMALL_LABEL_CLS} style={{ color: INK_DIM }}>Sentiment →</span>
                    <span className="text-[11px]" style={{ color: INK_DIM }}>100%</span>
                  </div>
                </div>
              </div>
            </div>
          {/* Cards, grouped by action — mobile only. */}
          <div className="grid md:hidden grid-cols-1 sm:grid-cols-2 gap-4 px-5 pt-5 pb-6 items-start">
            {groups.map(g => (
              <div key={g.key} className="flex flex-col gap-3">
                <div
                  className="flex items-center justify-between gap-2 pb-2.5 border-b-2"
                  style={{ borderColor: g.color }}
                >
                  <span className="font-headline text-[17px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>{g.title}</span>
                  {infoTip(g.blurb)}
                </div>
                {g.items.map(attributeCard)}
                {g.items.length === 0 && (
                  <span className="text-xs" style={{ color: INK_DIM }}>No attributes here yet.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attributes table — every attribute side by side on the metrics the
          matrix can't carry. Structure copies CompetitorsTab's "Card 3". */}
      {attributes.length > 0 && (
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-bold text-gray-800">Attributes</CardTitle>
              <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-xs">
                {attributes.length.toLocaleString()}
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
            {/* Filter row: search, Group, Category, Sources, Models. Job
                function and market are global — never duplicated here. */}
            <div className="flex items-center gap-2 flex-wrap pt-2">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search attributes..."
                className="max-w-xs"
              />
              <FilterDropdown label="Group" icon={Layers} options={tableFilterOptions.groups} selected={filterGroups} onChange={setFilterGroups} />
              <FilterDropdown label="Category" icon={Tags} options={tableFilterOptions.categories} selected={filterCategories} onChange={setFilterCategories} searchable />
              <FilterDropdown label="Sources" icon={Globe} options={tableFilterOptions.sources} selected={filterSources} onChange={setFilterSources} searchable />
              <FilterDropdown label="Models" icon={Bot} options={tableFilterOptions.models} selected={filterModels} onChange={setFilterModels} />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {filteredTableRows.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-sm">No attributes match the current filters.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <SortableHead label="Attribute" k="name" className="min-w-[230px]" />
                        <SortableHead label="Group" k="group" className="min-w-[110px]" />
                        <SortableHead label="Sentiment" k="sentiment" className="min-w-[170px]" />
                        <SortableHead label="Visibility" k="visibility" className="min-w-[110px]" />
                        <SortableHead label="Relevance" k="relevance" className="min-w-[100px]" />
                        <SortableHead label="Top sources cited" k="sources" className="min-w-[170px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTableRows.slice(tablePage * TABLE_PAGE_SIZE, (tablePage + 1) * TABLE_PAGE_SIZE).map(row => {
                        const RowIcon = ATTRIBUTE_ICONS[row.id] || Activity;
                        return (
                          <TableRow
                            key={row.id}
                            onClick={() => openAttribute(row.id)}
                            className="cursor-pointer transition-colors"
                          >
                            <TableCell>
                              <div className="flex items-center gap-2.5 min-w-0">
                                <RowIcon className="w-4 h-4 flex-none" style={{ color: INK_MUTED }} />
                                <span className="text-sm font-medium text-gray-900">{row.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                                <span className="w-2 h-2 rounded-full flex-none" style={{ background: GROUP_META[row.group].color }} />
                                {GROUP_META[row.group].title}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <span className="w-[38px] flex-none text-sm font-semibold text-gray-900 tabular-nums">
                                  {row.sentimentPct}%
                                </span>
                                <span className="flex-1 h-2 rounded-lg overflow-hidden max-w-[96px]" style={{ background: BAR_TRACK }}>
                                  <span className="block h-full rounded-lg" style={{ width: `${row.sentimentPct}%`, background: row.color }} />
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {row.visibilityPct === null ? emptyCell : (
                                <span className="text-sm font-semibold text-gray-900 tabular-nums">{row.visibilityPct.toFixed(1)}%</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.relevance === null
                                ? (rawExtrasPending || recencyDataLoading ? pendingCell : emptyCell)
                                : <span className="text-sm text-gray-600 tabular-nums">{row.relevance}</span>}
                            </TableCell>
                            <TableCell>
                              {row.sources.length === 0 ? (
                                rawExtrasPending ? pendingCell : emptyCell
                              ) : (
                                <TooltipProvider>
                                  {/* Overlapping stack, same as the Competitors and Sources tabs. */}
                                  <div className="flex items-center w-fit">
                                    <div className="flex items-center">
                                      {row.sources.map((domain, i) => (
                                        <Tooltip key={domain}>
                                          <TooltipTrigger asChild>
                                            <span
                                              className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 ring-2 ring-white cursor-help overflow-hidden"
                                              style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
                                            >
                                              <Favicon domain={domain} />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent><p className="text-xs">{domain}</p></TooltipContent>
                                        </Tooltip>
                                      ))}
                                    </div>
                                    {row.sourceCount > TOP_SOURCES_PER_ROW && (
                                      <span className="text-xs text-gray-400 pl-3 whitespace-nowrap">
                                        +{(row.sourceCount - TOP_SOURCES_PER_ROW).toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                </TooltipProvider>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <TablePagination
                  page={tablePage}
                  pageCount={Math.ceil(filteredTableRows.length / TABLE_PAGE_SIZE)}
                  onPageChange={setTablePage}
                  totalLabel={`${(tablePage * TABLE_PAGE_SIZE + 1).toLocaleString()}–${Math.min((tablePage + 1) * TABLE_PAGE_SIZE, filteredTableRows.length).toLocaleString()} of ${filteredTableRows.length.toLocaleString()} attributes`}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Attribute detail panel (Claude Design handoff, 2026-10). One scroll,
          no tabs. The sentiment split is the filter for quotes and sources;
          the comparison card ignores it. Rendered on the Radix primitives
          directly: the shared DialogContent adds a shadow and its own close
          button, and the spec wants neither. */}
      <DialogPrimitive.Root open={isModalOpen && !!modalAttribute} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            style={{ background: 'rgba(19,39,79,0.55)' }}
          />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed z-50 bg-white flex flex-col overflow-hidden outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200
              inset-x-0 bottom-0 top-[52px] rounded-t-[20px]
              md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(1000px,calc(100vw-40px))] md:max-h-[calc(100vh-80px)] md:rounded-[20px]"
            style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}
          >
            {modalAttribute && (() => {
              const IconComponent = ATTRIBUTE_ICONS[modalAttribute.id] || Activity;
              const rawSettling = attrThemes.length === 0 && !themesSettled;
              const status: 'loading' | 'ready' | 'error' =
                rawSettling || (attrThemes.length > 0 && detailStatus === 'loading') ? 'loading'
                : attrThemes.length === 0 || detailStatus === 'error' ? 'error'
                : 'ready';
              const retry = () => {
                if (attrThemes.length === 0) {
                  if (selectedAttribute) fetchAIThemesForAttribute?.(selectedAttribute);
                  setGraceElapsedFor(null);
                } else {
                  setDetailRetry(n => n + 1);
                }
              };
              const meterFilled = modalAttribute.band >= 4 ? 3 : modalAttribute.band === 3 ? 2 : 1;
              const eyebrow = 'text-[13px] font-semibold uppercase tracking-[0.16em]';
              const h3 = 'font-headline font-semibold text-xl tracking-[-0.015em] m-0';
              const filterMeta = polarity ? POLARITY_META[polarity] : null;
              const clearFilter = () => setPolarity(null);

              return (
                <div className="overflow-y-auto flex-1 min-h-0">
                  <div className="md:hidden flex justify-center pt-2.5 pb-1">
                    <div className="w-10 h-[5px] rounded-full" style={{ background: RULE_STRONG }} />
                  </div>
                  <div className="flex flex-col gap-6 md:gap-8 p-5 pb-7 md:p-10 md:pb-11">

                    {/* Header */}
                    <header className="relative flex flex-wrap items-end justify-between gap-y-5 gap-x-10 pr-[52px]">
                      <div className="flex gap-[18px] items-start min-w-0" style={{ flex: '1 1 320px' }}>
                        <div className="flex-none w-[52px] h-[52px] rounded-[14px] flex items-center justify-center" style={{ background: WASH.positive }}>
                          <IconComponent className="w-[26px] h-[26px]" style={{ color: '#0A8F8D' }} strokeWidth={1.75} />
                        </div>
                        <div className="flex flex-col gap-2 min-w-0">
                          <span className={eyebrow} style={{ color: INK_DIM }}>{companyName} · Attribute</span>
                          <DialogPrimitive.Title className="font-headline font-semibold text-2xl md:text-[30px] leading-[1.15] tracking-[-0.02em] m-0 [text-wrap:pretty]" style={{ color: INK }}>
                            {modalAttribute.name}
                          </DialogPrimitive.Title>
                          <div className="flex items-center gap-2.5 mt-0.5">
                            <span className="flex items-end gap-[3px] h-3.5" aria-hidden="true">
                              {[6, 10, 14].map((h, i) => (
                                <span key={h} className="w-1 rounded-[1px]" style={{ height: h, background: i < meterFilled ? TEAL : RULE_STRONG }} />
                              ))}
                            </span>
                            <span className="text-sm" style={{ color: INK_MUTED }}>Volume</span>
                            <span className="text-sm font-semibold">{modalAttribute.bandLabel}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-none">
                        <span className={eyebrow} style={{ color: INK_DIM }}>Sentiment score</span>
                        <div className="flex items-baseline font-headline font-bold leading-none tracking-[-0.045em]">
                          <span className="text-[56px] md:text-[72px]">{modalAttribute.sentimentPct}</span>
                          <span className="text-[30px] md:text-[36px] ml-0.5" style={{ color: NAVY_60 }}>%</span>
                        </div>
                        <span className="text-[13.5px] max-w-[240px]" style={{ color: INK_MUTED }}>Share of positive vs negative themes</span>
                      </div>
                      <button
                        onClick={closeModal}
                        aria-label="Close"
                        className="absolute top-0 right-0 w-10 h-10 rounded-full border bg-white flex items-center justify-center transition-colors hover:bg-[rgba(19,39,79,0.04)]"
                        style={{ borderColor: RULE }}
                      >
                        <X className="w-[18px] h-[18px]" strokeWidth={1.75} style={{ color: INK }} />
                      </button>
                    </header>

                    <div className="h-px" style={{ background: RULE }} />

                    {/* Error */}
                    {status === 'error' && (
                      <div className="border rounded-2xl p-7 md:p-12 flex flex-wrap items-center gap-y-5 gap-x-7" style={{ borderColor: RULE, background: CARD_LIGHT }}>
                        <div className="flex-none w-12 h-12 rounded-full bg-white border flex items-center justify-center" style={{ borderColor: RULE }}>
                          <AlertCircle className="w-[22px] h-[22px]" strokeWidth={1.75} style={{ color: INK }} />
                        </div>
                        <div className="flex flex-col gap-1.5" style={{ flex: '1 1 280px' }}>
                          <span className="font-headline font-semibold text-[19px] tracking-[-0.01em]">This attribute didn't load</span>
                          <span className="text-[15px] leading-[1.55] [text-wrap:pretty]" style={{ color: INK_MUTED }}>
                            The quotes and sources couldn't be fetched. Nothing is lost; try again in a moment.
                          </span>
                        </div>
                        <button
                          onClick={retry}
                          className="flex-none h-11 px-[22px] rounded-full text-white text-[14.5px] font-semibold flex items-center gap-2 transition-colors hover:bg-[#284472]"
                          style={{ background: INK }}
                        >
                          <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
                          Retry
                        </button>
                      </div>
                    )}

                    {status !== 'error' && (
                      <>
                        {/* Sentiment split: the filter */}
                        <section className="flex flex-col gap-4">
                          <div className="flex items-center justify-between gap-4 min-h-[28px]">
                            <span className={eyebrow} style={{ color: INK_DIM }}>Sentiment split</span>
                            {polarity && status === 'ready' && (
                              <button
                                onClick={clearFilter}
                                className="h-[30px] px-3 rounded-full border bg-white text-[13.5px] font-semibold flex items-center gap-1.5 transition-colors hover:bg-[rgba(19,39,79,0.04)]"
                                style={{ borderColor: RULE_STRONG, color: INK }}
                              >
                                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                                Reset filter
                              </button>
                            )}
                          </div>
                          <div className="flex gap-1 h-24 md:h-28">
                            {splitCounts.map((s, i) => {
                              const pct = splitTotal > 0 ? (s.n / splitTotal) * 100 : 0;
                              const active = polarity === s.key;
                              const radius = i === 0 ? '14px 4px 4px 14px' : i === splitCounts.length - 1 ? '4px 14px 14px 4px' : '4px';
                              if (status === 'loading') {
                                return <div key={s.key} style={{ flex: `${Math.max(pct, 8)} 1 0px`, borderRadius: radius, background: CARD_FILL }} />;
                              }
                              return (
                                <button
                                  key={s.key}
                                  onClick={() => togglePolarity(s.key)}
                                  aria-pressed={active}
                                  aria-label={`Filter to ${POLARITY_LABEL[s.key].toLowerCase()} (${pct.toFixed(1)}%)`}
                                  className="relative overflow-hidden border-0 text-left flex flex-col justify-between min-w-[92px] p-2.5 pt-3.5 md:p-4 md:pt-5 transition-opacity duration-[180ms] hover:brightness-[0.97]"
                                  style={{
                                    flex: `${Math.max(pct, 8)} 1 0px`,
                                    borderRadius: radius,
                                    background: WASH[s.key],
                                    outline: active ? `2px solid ${INK}` : '0 solid transparent',
                                    outlineOffset: -2,
                                    opacity: polarity && !active ? 0.4 : 1,
                                    color: INK,
                                  }}
                                >
                                  <span className="absolute left-0 right-0 top-0 h-[5px]" style={{ background: POLARITY_META[s.key].strip }} />
                                  <span className="flex items-baseline font-headline font-bold leading-none tracking-[-0.04em] text-[22px] md:text-4xl">
                                    {pct.toFixed(1)}<span className="text-[0.55em] ml-px" style={{ color: NAVY_60 }}>%</span>
                                  </span>
                                  <span className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap">
                                    {POLARITY_LABEL[s.key]}
                                    {active && <Check className="w-3.5 h-3.5" strokeWidth={2.25} />}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {status === 'ready' && (
                            <span className="text-[13px]" style={{ color: INK_DIM }}>
                              {filterMeta
                                ? `Filtered to ${filterMeta.label.toLowerCase()} themes. Select it again or reset to see all.`
                                : 'Share of themes in AI answers. Select a share to filter quotes and sources.'}
                            </span>
                          )}
                        </section>

                        {/* Body */}
                        <div className="flex flex-wrap items-start gap-7 md:gap-10">

                          {/* What AI says */}
                          <section className="min-w-0 flex flex-col gap-4" style={{ flex: '1.7 1 440px' }}>
                            <div className="flex flex-col gap-1">
                              <h3 className={h3}>What AI says</h3>
                              <span className="text-sm" style={{ color: INK_MUTED }}>Verbatim excerpts from recent AI answers about {companyName}.</span>
                            </div>

                            {filterMeta && status === 'ready' && (
                              <div className="flex items-center gap-2.5 flex-wrap rounded-xl py-2.5 pl-3.5 pr-3" style={{ background: filterMeta.wash }}>
                                <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: filterMeta.color }} />
                                <span className="text-sm">Showing <strong className="font-semibold">{filterMeta.label}</strong> themes only</span>
                                <button onClick={clearFilter} className="ml-auto h-7 px-2.5 rounded-full text-[13.5px] font-semibold underline underline-offset-[3px]" style={{ color: INK }}>
                                  Show all
                                </button>
                              </div>
                            )}

                            {status === 'loading' && (
                              <div className="flex flex-col gap-3" aria-busy="true">
                                {[0, 1, 2].map(i => (
                                  <div key={i} className="border rounded-[14px] px-[22px] py-5 flex flex-col gap-2.5" style={{ borderColor: RULE }}>
                                    <div className="w-[84px] h-[13px] rounded" style={{ background: CARD_FILL }} />
                                    <div className="h-3.5 rounded" style={{ background: CARD_FILL }} />
                                    <div className="h-3.5 rounded" style={{ background: CARD_FILL }} />
                                    <div className="h-3.5 rounded w-[62%]" style={{ background: CARD_FILL }} />
                                    <div className="h-px my-1.5" style={{ background: RULE }} />
                                    <div className="flex gap-3">
                                      <div className="w-[110px] h-5 rounded-md" style={{ background: CARD_FILL }} />
                                      <div className="w-[140px] h-5 rounded-md" style={{ background: CARD_FILL }} />
                                    </div>
                                  </div>
                                ))}
                                <span className="text-[13.5px]" style={{ color: INK_DIM }}>Loading recent answers…</span>
                              </div>
                            )}

                            {status === 'ready' && visibleQuotes.length > 0 && (
                              <div className="flex flex-col gap-3">
                                {visibleQuotes.map(q => {
                                  const expanded = !!expandedQuotes[q.id];
                                  const flag = q.market ? locationFlag(q.market) : '';
                                  return (
                                    <article key={q.id} className="border rounded-[14px] bg-white px-[22px] pt-5 pb-4 flex flex-col gap-3" style={{ borderColor: RULE }}>
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                          <span className="w-2 h-2 rounded-full" style={{ background: POLARITY_COLOR[q.polarity] }} />
                                          <span className="text-[13px] font-semibold uppercase tracking-[0.12em]" style={{ color: INK_MUTED }}>{POLARITY_LABEL[q.polarity]}</span>
                                        </div>
                                        {q.themeName && (
                                          <span className="font-headline font-semibold text-[17px] leading-snug [text-wrap:pretty]" style={{ color: INK }}>{q.themeName}</span>
                                        )}
                                      </div>
                                      <blockquote
                                        className="m-0 text-base leading-[1.62] [text-wrap:pretty]"
                                        style={expanded ? { color: INK } : { color: INK, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4, overflow: 'hidden' }}
                                      >
                                        “{expanded && q.context ? q.context : q.text}”
                                      </blockquote>
                                      {(q.context || q.text.length > 240) && (
                                        <button
                                          onClick={() => setExpandedQuotes(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
                                          className="self-start p-0 text-[13.5px] font-semibold underline underline-offset-[3px]"
                                          style={{ color: INK, textDecorationColor: RULE_STRONG }}
                                        >
                                          {expanded ? 'Show less' : q.context ? 'Read in context' : 'Read full excerpt'}
                                        </button>
                                      )}
                                      <div className="h-px" style={{ background: RULE }} />
                                      <div className="flex flex-wrap items-center gap-y-2 gap-x-3.5 text-[13.5px]" style={{ color: INK_MUTED }}>
                                        <span className="flex items-center gap-2 font-semibold" style={{ color: INK }}>
                                          {q.model && getLLMLogo(q.model) && (
                                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-[5px] bg-white border" style={{ borderColor: RULE }}>
                                              <LLMLogo modelName={q.model} size="sm" showFallback={false} />
                                            </span>
                                          )}
                                          {q.model ? getLLMDisplayName(q.model) : 'AI answer'}
                                        </span>
                                        {q.jobFunction && (
                                          <>
                                            <span className="w-[3px] h-[3px] rounded-full" style={{ background: RULE_STRONG }} />
                                            <span>{q.jobFunction}</span>
                                          </>
                                        )}
                                        {q.market && (
                                          <>
                                            <span className="w-[3px] h-[3px] rounded-full" style={{ background: RULE_STRONG }} />
                                            <span className="flex items-center gap-1.5">
                                              {flag && <span className="text-[15px]" aria-hidden="true">{flag}</span>}
                                              {locationDisplayName(q.market)}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                      {q.cites.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-y-1.5 gap-x-2 text-[12.5px]" style={{ color: INK_DIM }}>
                                          <span>Cited in this answer</span>
                                          {q.cites.map(c => (
                                            <a
                                              key={c.domain}
                                              href={c.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-full border bg-white font-mono text-[12px] transition-colors hover:bg-[rgba(19,39,79,0.04)]"
                                              style={{ borderColor: RULE, color: INK }}
                                            >
                                              <Favicon domain={c.domain} size="sm" />
                                              {c.domain}
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                    </article>
                                  );
                                })}
                              </div>
                            )}

                            {status === 'ready' && visibleQuotes.length === 0 && (
                              <div className="border border-dashed rounded-[14px] px-7 py-10 flex flex-col items-center text-center gap-2" style={{ borderColor: RULE_STRONG }}>
                                <span className="font-headline font-semibold text-lg">No quotes for this filter</span>
                                <span className="text-[14.5px] leading-[1.55] max-w-[380px] [text-wrap:pretty]" style={{ color: INK_MUTED }}>
                                  {filterMeta
                                    ? `Recent AI answers on this topic don't carry ${filterMeta.label.toLowerCase()} themes for ${companyName}.`
                                    : `Recent AI answers on this topic don't carry quotable text for ${companyName}.`}
                                </span>
                                {filterMeta && (
                                  <button onClick={clearFilter} className="mt-2.5 h-10 px-[18px] rounded-full border bg-white text-sm font-semibold transition-colors hover:bg-[rgba(19,39,79,0.04)]" style={{ borderColor: RULE_STRONG, color: INK }}>
                                    Show all sentiment
                                  </button>
                                )}
                              </div>
                            )}
                          </section>

                          {/* Side column */}
                          <div className="min-w-0 flex flex-col gap-4" style={{ flex: '1 1 260px' }}>
                            <aside className="rounded-2xl border px-[22px] pt-[22px] pb-6 flex flex-col gap-[18px]" style={{ background: CARD_LIGHT, borderColor: RULE }}>
                              <div className="flex flex-col gap-1">
                                <h3 className={h3}>Where it comes from</h3>
                                <span className="text-[13.5px]" style={{ color: INK_MUTED }}>Share of recent answers citing each source.</span>
                              </div>
                              {status === 'loading' && (
                                <div className="flex flex-col gap-[18px]" aria-busy="true">
                                  {[0, 1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="flex flex-col gap-[9px]">
                                      <div className="flex gap-2.5 items-center">
                                        <div className="w-[22px] h-[22px] rounded-[5px]" style={{ background: CARD_FILL }} />
                                        <div className="w-[120px] h-[13px] rounded" style={{ background: CARD_FILL }} />
                                      </div>
                                      <div className="h-1.5 rounded-full" style={{ background: CARD_FILL }} />
                                    </div>
                                  ))}
                                </div>
                              )}
                              {status === 'ready' && sourceCoverage.rows.length > 0 && (
                                <ol className="list-none m-0 p-0 flex flex-col gap-4">
                                  {sourceCoverage.rows.map(s => (
                                    <li key={s.domain} className="flex flex-col gap-2">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-[5px] bg-white border flex-none" style={{ borderColor: RULE }}>
                                          <Favicon domain={s.domain} size="md" />
                                        </span>
                                        <span className="flex-1 min-w-0 font-mono text-[13.5px] truncate" style={{ color: INK }}>{s.domain}</span>
                                        <span className="text-sm font-semibold w-10 text-right">{s.pct}%</span>
                                      </div>
                                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BAR_TRACK }}>
                                        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${s.pct}%`, background: TEAL }} />
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              )}
                              {status === 'ready' && sourceCoverage.rows.length === 0 && (
                                <span className="px-1 py-5 text-sm leading-[1.55]" style={{ color: INK_MUTED }}>No sources cited for this filter.</span>
                              )}
                            </aside>

                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
});
ThematicAnalysisTab.displayName = 'ThematicAnalysisTab';
