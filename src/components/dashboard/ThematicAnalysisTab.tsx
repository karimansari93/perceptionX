import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DataUnavailable } from './DataUnavailable';
import type { DashboardFamilyStatus } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePersistedState } from '@/hooks/usePersistedState';
import { sentimentRatioV2, isExcludedAiModel } from '@/lib/sentimentV2';
import { supabase } from '@/integrations/supabase/client';
import { enhanceCitations, extractSourceUrl } from '@/utils/citationUtils';
import { quarterKeyOfMonthStr } from '@/utils/quarterKey';
import type { ScopeStatsRow, ScopePromptTypeStatsRow } from '@/hooks/dashboard/dashboardQueries';
import {
  Loader2,
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
  TrendingUp,
  TrendingDown,
  FileText,
  MessageSquare,
  ClipboardList,
  MessageCircle,
  UserCheck,
  Briefcase,
  Info,
  X,
  Layers,
  Tags,
  Globe,
  Bot
} from 'lucide-react';
import { PromptResponse } from '@/types/dashboard';
import { ATTRIBUTES, normalizeAttributeId, getAttributeIdByName } from '@/config/attributes';
import { ATTRIBUTE_ICONS } from '@/config/attributeIcons';
import { getLLMDisplayName } from '@/config/llmLogos';
import { Favicon } from '@/components/ui/favicon';
import LLMLogo from '@/components/LLMLogo';
import { useTabSearchSeed } from '@/contexts/TabSearchSeedContext';
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
  // Measured company id — scopes the competitor_themes read behind the
  // attributes table's "Competitor gap" column (the same fetch CompetitorsTab
  // makes for its head-to-head sentiment).
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
type TableSortKey = 'name' | 'group' | 'sentiment' | 'visibility' | 'relevance' | 'gap' | 'sources';

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
  const [selectedAttribute, setSelectedAttribute] = usePersistedState<string | null>('thematicTab.selectedAttribute', null);
  const [isModalOpen, setIsModalOpen] = usePersistedState<boolean>('thematicTab.isModalOpen', false);
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

  // Competitor ↔ attribute ↔ sentiment triples (competitor_themes), the
  // competitive-set side of the table's "Competitor gap". Loaded once per
  // company, exactly as CompetitorsTab does; rows only exist for responses
  // themed after the extraction pass started emitting them, so the column
  // degrades to "—" for an attribute with no rows yet.
  const [competitorThemeRows, setCompetitorThemeRows] = useState<any[]>([]);
  const [competitorThemesLoaded, setCompetitorThemesLoaded] = useState(false);
  useEffect(() => {
    if (!currentCompanyId) {
      setCompetitorThemeRows([]);
      setCompetitorThemesLoaded(true);
      return;
    }
    let cancelled = false;
    setCompetitorThemesLoaded(false);
    (async () => {
      const PAGE = 1000;
      const all: any[] = [];
      try {
        for (let page = 0; page < 25; page += 1) {
          const { data, error } = await (supabase as any)
            .from('competitor_themes')
            .select('response_id, competitor_name, attribute_id, sentiment')
            .eq('company_id', currentCompanyId)
            .range(page * PAGE, (page + 1) * PAGE - 1);
          if (cancelled) return;
          if (error) {
            console.warn('competitor_themes fetch failed:', error.message);
            break;
          }
          all.push(...(data ?? []));
          if (!data || data.length < PAGE) break;
        }
      } catch (err) {
        console.warn('competitor_themes fetch failed:', err);
      }
      if (!cancelled) {
        setCompetitorThemeRows(all);
        setCompetitorThemesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [currentCompanyId]);

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
      if (!attrId || isExcludedAiModel(r.ai_model)) continue;
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

  // Competitive-set sentiment per attribute from the competitor_themes triples
  // on in-scope answers: each competitor's methodology-v2 ratio, then the
  // unweighted mean across competitors — the same "own minus peer average"
  // family as the competitor benchmark's sentiment_gap.
  const competitorSentimentByAttr = useMemo(() => {
    const out = new Map<string, number>();
    if (competitorThemeRows.length === 0) return out;
    const inScope = new Set(streamInScope.map(r => r.id));
    const byAttr = new Map<string, Map<string, { positive: number; negative: number }>>();
    for (const row of competitorThemeRows) {
      if (!inScope.has(row.response_id)) continue;
      const attrId = normalizeAttributeId(row.attribute_id);
      if (!attrId || !row.competitor_name) continue;
      let comps = byAttr.get(attrId);
      if (!comps) {
        comps = new Map();
        byAttr.set(attrId, comps);
      }
      const c = comps.get(row.competitor_name) ?? { positive: 0, negative: 0 };
      if (row.sentiment === 'positive') c.positive += 1;
      else if (row.sentiment === 'negative') c.negative += 1;
      comps.set(row.competitor_name, c);
    }
    byAttr.forEach((comps, attrId) => {
      const ratios: number[] = [];
      comps.forEach(c => {
        const ratio = sentimentRatioV2(c.positive, c.negative);
        if (ratio !== null) ratios.push(ratio * 100);
      });
      if (ratios.length > 0) out.set(attrId, ratios.reduce((a, b) => a + b, 0) / ratios.length);
    });
    return out;
  }, [competitorThemeRows, streamInScope]);

  type AttributeTableRow = {
    id: string;
    name: string;
    category: string;
    group: GroupKey;
    sentimentPct: number;
    color: string;
    visibilityPct: number | null;
    relevance: number | null;
    gapPts: number | null;
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
    const peer = competitorSentimentByAttr.get(a.id);
    return {
      id: a.id,
      name: a.name,
      category: ATTRIBUTES.find(x => x.id === a.id)?.category ?? 'Other',
      group: a.group,
      sentimentPct: a.sentimentPct,
      color: a.color,
      visibilityPct: totalScopedAnswers > 0 ? Math.min(100, (a.count / totalScopedAnswers) * 100) : null,
      relevance: extras && extras.recencyN > 0 ? Math.round(extras.recencySum / extras.recencyN) : null,
      gapPts: peer === undefined ? null : Math.round(a.sentimentPct - peer),
      sources: domainsRanked.slice(0, TOP_SOURCES_PER_ROW),
      domains: domainsRanked,
      sourceCount: domainsRanked.length,
      models: extras ? Array.from(extras.models).sort() : [],
    };
  }), [attributes, attributeExtras, competitorSentimentByAttr, totalScopedAnswers]);

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
        case 'gap': return num(a.gapPts, b.gapPts);
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

  // Sources cited, split by the polarity of the theme instance that cites
  // them — so the sentiment filter can recompute shares over the filtered
  // citation counts. Citations parse ONCE per response (many theme rows share
  // a response; parsing per row froze the tab for seconds on big attributes).
  const attrSources = useMemo(() => {
    if (attrThemes.length === 0) return [] as { domain: string; positive: number; neutral: number; negative: number }[];
    const responseById = new Map(responses.map(r => [r.id, r]));
    const citationsByResponse = new Map<string, string[]>();
    const citationDomains = (responseId: string): string[] => {
      const cached = citationsByResponse.get(responseId);
      if (cached) return cached;
      let domains: string[] = [];
      const response = responseById.get(responseId);
      if (response) {
        try {
          const citations = typeof response.citations === 'string'
            ? JSON.parse(response.citations)
            : response.citations;
          if (Array.isArray(citations)) {
            // Fold www. into the bare domain so one source never shows twice.
            domains = citations
              .map((c: any) => (c?.domain ? String(c.domain).replace(/^www\./, '') : null))
              .filter(Boolean) as string[];
          }
        } catch { /* skip invalid citations */ }
      }
      citationsByResponse.set(responseId, domains);
      return domains;
    };
    const map = new Map<string, { domain: string; positive: number; neutral: number; negative: number }>();
    attrThemes.forEach(t => {
      citationDomains(t.response_id).forEach(domain => {
        const s = map.get(domain) ?? { domain, positive: 0, neutral: 0, negative: 0 };
        s[t.sentiment] += 1;
        map.set(domain, s);
      });
    });
    return [...map.values()];
  }, [attrThemes, responses]);

  // Verbatim quotes — excerpts anchored on theme keywords so each quote is
  // actually about this attribute; each carries the matched theme (for the
  // theme filter), polarity, AI platform and market.
  const attrResponses = useMemo(() => {
    // attrThemes is [] while the drilldown is closed — skip the full responses
    // scan on every stream/scope change until one is actually open.
    if (attrThemes.length === 0) return [];
    const ids = new Set(attrThemes.map(t => t.response_id));
    return responses.filter(r => ids.has(r.id));
  }, [attrThemes, responses]);

  // Response texts are lazy-loaded (the eager dashboard query omits them) —
  // fetch them for the open attribute's responses so the quotes can render.
  const quoteTextFetchKeyRef = useRef<string>('');
  useEffect(() => {
    if (!isModalOpen || !selectedAttribute || !fetchResponseTexts) return;
    if (attrResponses.length === 0) return;
    if (quoteTextFetchKeyRef.current === selectedAttribute) return;
    const missing = attrResponses
      .filter(r => !(responseTexts[r.id] || r.response_text))
      .map(r => r.id)
      .slice(0, 60);
    quoteTextFetchKeyRef.current = selectedAttribute;
    if (missing.length > 0) fetchResponseTexts(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, selectedAttribute, attrResponses]);

  const quotes = useMemo(() => {
    const themesByResponse = new Map<string, AITheme[]>();
    attrThemes.forEach(t => {
      const list = themesByResponse.get(t.response_id) ?? [];
      list.push(t);
      themesByResponse.set(t.response_id, list);
    });
    const out: {
      id: string;
      text: string;
      model?: string;
      market?: string | null;
      polarity: 'positive' | 'neutral' | 'negative';
      theme: string | null;
    }[] = [];
    for (const r of attrResponses) {
      // Strip markdown noise so quotes read as prose ("**", "###",
      // and the known "• undefined:" data artifact).
      const text = (responseTexts[r.id] || r.response_text || '')
        .replace(/•\s*undefined:\s*/g, '• ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\s#{1,6}\s+/g, ' ')
        .replace(/\*\*/g, '');
      if (!text.trim()) continue;
      const rThemes = themesByResponse.get(r.id) ?? [];
      let idx = -1;
      let matched: AITheme | null = null;
      for (const t of rThemes) {
        const needles = [...(Array.isArray(t.keywords) ? t.keywords : []), t.theme_name].filter(Boolean);
        for (const n of needles) {
          const i = text.toLowerCase().indexOf(String(n).toLowerCase());
          if (i !== -1 && (idx === -1 || i < idx)) {
            idx = i;
            matched = t;
          }
        }
      }
      const anchor = idx === -1 ? 0 : idx;
      const start = Math.max(0, anchor - 80);
      const end = Math.min(text.length, anchor + 240);
      const excerpt = text.slice(start, end).trim();
      if (!excerpt) continue;
      const fallback = rThemes[0] ?? null;
      out.push({
        id: r.id,
        model: r.ai_model,
        market: r.confirmed_prompts?.location_context ?? null,
        polarity: (matched?.sentiment || fallback?.sentiment || 'neutral') as 'positive' | 'neutral' | 'negative',
        theme: matched?.theme_name || fallback?.theme_name || null,
        text: `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`,
      });
      if (out.length >= 12) break;
    }
    return out;
  }, [attrResponses, attrThemes, responseTexts]);

  // Filtered views. The polarity filter narrows quotes and sources together.
  const visibleSources = useMemo(() => {
    const total = (s: { positive: number; neutral: number; negative: number }) =>
      s.positive + s.neutral + s.negative;
    const val = (s: { positive: number; neutral: number; negative: number }) =>
      polarity ? s[polarity] : total(s);
    return attrSources
      .map(s => ({
        domain: s.domain,
        value: val(s),
        pctPositive: total(s) > 0 ? Math.round((s.positive / total(s)) * 100) : 0,
      }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [attrSources, polarity]);
  const visibleQuotes = useMemo(
    () => quotes.filter(q => !polarity || q.polarity === polarity),
    [quotes, polarity]
  );

  const closeModal = () => {
    setIsModalOpen(false);
    setPolarity(null);
  };

  const togglePolarity = (key: 'positive' | 'neutral' | 'negative') => {
    setPolarity(prev => (prev === key ? null : key));
  };

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
                        <SortableHead label="Competitor gap" k="gap" className="min-w-[110px]" />
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
                              {row.gapPts === null ? (
                                rawExtrasPending || !competitorThemesLoaded ? pendingCell : emptyCell
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 text-xs font-semibold"
                                  style={{ color: row.gapPts > 0 ? '#0A9A98' : row.gapPts < 0 ? PINK : INK_DIM }}
                                >
                                  {row.gapPts > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : row.gapPts < 0 ? <TrendingDown className="w-3 h-3 flex-shrink-0" /> : null}
                                  <span className="whitespace-nowrap">
                                    {row.gapPts > 0 ? '+' : row.gapPts < 0 ? '−' : ''}{Math.abs(row.gapPts)} pts
                                  </span>
                                </span>
                              )}
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

      {/* Attribute detail modal — one scroll, no tabs. The sentiment split is
          the primary filter for everything below it. */}
      <Dialog open={isModalOpen && !!modalAttribute} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-[1056px] w-[calc(100vw-32px)] p-0 gap-0 rounded-[20px] overflow-hidden max-h-[92vh] flex flex-col [&>button]:hidden"
        >
          {modalAttribute && (() => {
            const IconComponent = ATTRIBUTE_ICONS[modalAttribute.id] || Activity;
            const srcFilteredTotal = visibleSources.reduce((a, s) => a + s.value, 0) || 1;
            const maxSrc = Math.max(1, ...visibleSources.map(s => s.value));
            const rawSettling = attrThemes.length === 0 && !themesSettled;

            return (
              <div className="overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between gap-5 px-7 py-[22px] border-b" style={{ borderColor: RULE }}>
                  <div className="flex items-center gap-3.5 min-w-0">
                    <IconComponent className="w-[22px] h-[22px] flex-none" style={{ color: INK }} />
                    <div className="flex flex-col gap-[3px] min-w-0">
                      <DialogTitle className="font-headline text-2xl font-semibold tracking-[-0.02em] leading-tight truncate" style={{ color: INK }}>
                        {modalAttribute.name}
                      </DialogTitle>
                      <span className="text-[11px]" style={{ color: INK_MUTED }}>
                        {modalAttribute.bandLabel} volume · {splitTotal.toLocaleString()} mentions
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-[22px] flex-none">
                    <div className="flex flex-col items-end">
                      <span className="font-headline text-[34px] font-semibold tracking-[-0.03em] leading-none tabular-nums" style={{ color: INK }}>
                        {modalAttribute.sentimentPct}%
                      </span>
                      <span className={SMALL_LABEL_CLS} style={{ color: INK_DIM }}>Sentiment</span>
                    </div>
                    <button onClick={closeModal} aria-label="Close" className="p-1 -m-1" style={{ color: INK_DIM }}>
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Sentiment split — the primary filter */}
                <div className="px-7 py-[22px] border-b flex flex-col gap-3" style={{ borderColor: RULE }}>
                  <div className="flex h-3.5 rounded-lg overflow-hidden gap-[2px]">
                    {splitCounts.filter(s => s.n > 0).map(s => (
                      <button
                        key={s.key}
                        onClick={() => togglePolarity(s.key)}
                        title={`Show ${POLARITY_LABEL[s.key]} only`}
                        className="cursor-pointer transition-opacity border-0 p-0"
                        style={{
                          width: `${(s.n / splitTotal) * 100}%`,
                          background: POLARITY_COLOR[s.key],
                          opacity: !polarity || polarity === s.key ? 1 : 0.32,
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-7 flex-wrap">
                    {splitCounts.map(s => (
                      <button
                        key={s.key}
                        onClick={() => togglePolarity(s.key)}
                        className="flex items-baseline gap-2 cursor-pointer bg-transparent border-0 p-0 transition-opacity"
                        style={{ opacity: !polarity || polarity === s.key ? 1 : 0.32 }}
                      >
                        <span className="w-[9px] h-[9px] rounded-full self-center" style={{ background: POLARITY_COLOR[s.key] }} />
                        <span
                          className="font-headline text-lg tabular-nums"
                          style={{ color: INK, fontWeight: polarity === s.key ? 700 : 600 }}
                        >
                          {s.n.toLocaleString()}
                        </span>
                        <span className="text-xs" style={{ color: INK_MUTED }}>
                          {POLARITY_LABEL[s.key]} · {splitTotal > 0 ? ((s.n / splitTotal) * 100).toFixed(1) : '0.0'}%
                        </span>
                      </button>
                    ))}
                    {polarity && (
                      <button
                        onClick={() => setPolarity(null)}
                        title="Clear the sentiment filter"
                        className="ml-auto text-xs font-semibold px-3 py-[5px] rounded-full text-white"
                        style={{ background: INK }}
                      >
                        {POLARITY_LABEL[polarity]} only ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Body — quotes | sources */}
                {rawSettling ? (
                  <div className="flex items-center justify-center gap-2 py-16" style={{ color: INK_DIM }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                ) : attrThemes.length === 0 ? (
                  <div className="py-16 text-center text-sm" style={{ color: INK_MUTED }}>
                    No detail available for this attribute yet.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_340px]">
                      {/* In their words — verbatim quotes, filtered by the split */}
                      <div className="px-7 py-6 md:border-r flex flex-col gap-3.5" style={{ borderColor: RULE }}>
                        <div className="flex items-baseline justify-between">
                          <span className={EYEBROW_CLS} style={{ color: PINK }}>In their words</span>
                          <span className="text-[11px]" style={{ color: INK_DIM }}>
                            {visibleQuotes.length} of {quotes.length} quotes
                          </span>
                        </div>
                        {visibleQuotes.length > 0 ? (
                          visibleQuotes.map(q => (
                            <div
                              key={q.id}
                              className="border rounded-[14px] px-[18px] py-4 flex flex-col gap-3"
                              style={{ borderColor: RULE, background: CARD_FILL }}
                            >
                              <p className="text-sm leading-[1.55] m-0 [text-wrap:pretty]" style={{ color: INK }}>
                                “{q.text}”
                              </p>
                              <div className="flex items-center gap-2.5">
                                <span className="w-2 h-2 rounded-full flex-none" style={{ background: POLARITY_COLOR[q.polarity] }} />
                                <span className="text-[11px]" style={{ color: INK_MUTED }}>
                                  {q.model ? getLLMDisplayName(q.model) : 'AI answer'}{q.market ? ` · ${q.market}` : ''}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <span className="text-[13px]" style={{ color: INK_MUTED }}>
                            No verbatim quotes match this filter.
                          </span>
                        )}
                      </div>

                      {/* Sources cited */}
                      <div className="px-7 py-6 flex flex-col gap-3.5">
                        <div className="flex items-center gap-2">
                          <span className={EYEBROW_CLS} style={{ color: PINK }}>Sources cited</span>
                          {infoTip('Bar length is citations from that domain within the current sentiment filter. The percentage is its share of them.')}
                        </div>
                        {visibleSources.map(s => (
                          <div key={s.domain} className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: INK }}>
                                <Favicon domain={s.domain} size="sm" />
                                {s.domain}
                              </span>
                              <span className="text-xs tabular-nums" style={{ color: INK }}>
                                {Math.round((s.value / srcFilteredTotal) * 100)}%
                              </span>
                            </div>
                            <div className="h-2 rounded-lg" style={{ background: BAR_TRACK }}>
                              <div className="h-full rounded-lg" style={{ width: `${(s.value / maxSrc) * 100}%`, background: TEAL }} />
                            </div>
                            <span className="text-[11px]" style={{ color: INK_DIM }}>
                              {s.value.toLocaleString()} citations · {s.pctPositive}% positive overall
                            </span>
                          </div>
                        ))}
                        {visibleSources.length === 0 && (
                          <span className="text-[13px]" style={{ color: INK_MUTED }}>No cited sources under this filter.</span>
                        )}
                        <span className="text-[11px] mt-0.5" style={{ color: INK_DIM }}>
                          {polarity ? `${POLARITY_LABEL[polarity]} citations only` : 'Citations by source'}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
});
ThematicAnalysisTab.displayName = 'ThematicAnalysisTab';
