import { useState, useEffect, useMemo, useRef, memo } from "react";
import type { DomainStats, CompetitorStats, ScopeStatsRow, ScopeDailyStatsRow, ScopePromptTypeStatsRow } from '@/hooks/dashboard/dashboardQueries';
import { poolCompetitorRows } from '@/hooks/dashboard/scopeStatsSelect';
import { quarterKeyOfMonthStr } from '@/utils/quarterKey';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount, LLMMentionRanking } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target, HelpCircle, X, TrendingDown, Sparkles, Loader2, CheckCircle2, Minus } from 'lucide-react';
import { usePersistedState } from "@/hooks/usePersistedState";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EpsDrilldownSheet } from "./EpsDrilldownSheet";
import { computeDiscoveryStats } from "@/lib/discoveryStats";
import { sentimentRatioV2 } from "@/lib/sentimentV2";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LLMLogo from "@/components/LLMLogo";
import { SourcesSummaryCard } from "./SourcesSummaryCard";
import { CompetitorsSummaryCard } from "./CompetitorsSummaryCard";
import { AttributesSummaryCard } from "./AttributesSummaryCard";
import { ScrollablePills } from "./ScrollablePills";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Favicon } from "@/components/ui/favicon";
import { extractSourceUrl, getFavicon } from "@/utils/citationUtils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, BarChart, Bar, ResponsiveContainer, Cell } from "recharts"

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

interface OverviewTabProps {
  // Phase-3 cubes (see docs/DASHBOARD_DATA_ARCHITECTURE.md): pre-aggregated
  // inputs that replace raw-row scans; undefined while a scope's stats are
  // still backfilling (consumers keep their raw fallback). The scope/daily/
  // prompt-type rows arrive LOCATION-FILTERED with job function and month
  // kept, so pill/period toggles pool client-side.
  domainStats?: DomainStats;
  competitorStats?: CompetitorStats;
  cubeScopeRows?: ScopeStatsRow[];
  cubePromptTypeRows?: ScopePromptTypeStatsRow[];
  cubeDailyRows?: ScopeDailyStatsRow[];
  cubeDailyUnsound?: boolean;
  cubeQuarterKey?: string | null;
  cubePrevQuarterKey?: string | null;
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  topCompetitors: { company: string; count: number }[];
  responses: any[]; // Add responses prop
  competitorLoading?: boolean; // Add competitor loading prop
  companyName: string; // <-- Add this
  llmMentionRankings: LLMMentionRanking[]; // Add this
  searchResults?: any[]; // Add search results
  aiThemes?: AITheme[]; // Add AI themes as prop
  attributeThemes?: any[]; // Pre-aggregated attribute scores (company_attribute_themes_mv)
  responseSentimentRows?: any[]; // Per-response sentiment ratios (company_response_sentiment_mv)
  recencyData?: any[]; // Add recency data for relevance calculation
  recencyDataLoading?: boolean; // Loading state for recency data
  aiThemesLoading?: boolean; // Loading state for AI themes
  // True while the raw response stream is still arriving (loads AFTER first
  // paint) — raw-derived summary cards skeleton instead of "No data".
  responsesLoading?: boolean;
  metricsCalculating?: boolean; // Whether metrics are still being calculated (for UX - show all together)
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  // Fields are optional because the MV may not yet have per-month data for
  // the previous period — in that case we skip the delta arrow instead of
  // silently comparing against 0.
  previousPeriodMetrics?: { sentimentScore?: number; visibilityScore?: number; relevanceScore?: number } | null;
  companyRelevanceByMonth?: Record<string, number>;
  previousPeriodResponses?: any[];
  // Per-month EPS series (oldest → selected period) for the headline sparkline,
  // and the period-over-period EPS delta. Both are global (un-filtered).
  epsTrend?: Array<{ key: string; date: string; score: number; sentiment: number; visibility: number; relevance: number; responseCount: number }>;
  epsChange?: number | null;
  // Same, keyed by job function — used when the function filter is active.
  epsTrendByJobFunction?: Record<string, Array<{ key: string; date: string; score: number; sentiment: number; visibility: number; relevance: number; responseCount: number }>>;
  epsChangeByJobFunction?: Record<string, number | null>;
  market?: string | null;
  // Per-job-function scorecard metrics — lets the function filter rescope EPS/Breakdown.
  metricsByJobFunction?: Record<string, {
    perceptionScore: number;
    perceptionLabel: string;
    sentimentScore: number;
    visibilityScore: number;
    relevanceScore: number;
  }>;
  // Global job-function filter, shared across all dashboard tabs and owned by
  // the parent Dashboard so a selection persists when switching tabs.
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
}

interface TimeBasedData {
  name: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

const normalizeCompetitorName = (name: string): string => {
  const lowerName = name.trim().toLowerCase();
  const aliases: { [key: string]: string } = {
    'amazon web services': 'AWS',
    'google cloud': 'GCP',
    // Add other aliases as needed
  };
  for (const alias in aliases) {
    if (lowerName === alias) {
      return aliases[alias];
    }
  }
  return name.trim().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

export const OverviewTab = memo(({
  domainStats,
  competitorStats,
  cubeScopeRows,
  cubePromptTypeRows,
  cubeDailyRows,
  cubeDailyUnsound = false,
  cubeQuarterKey = null,
  cubePrevQuarterKey = null,
  metrics,
  topCitations,
  topCompetitors,
  responses,
  competitorLoading = false,
  companyName,
  llmMentionRankings,
  searchResults = [],
  aiThemes = [],
  attributeThemes = [],
  responseSentimentRows = [],
  recencyData = [],
  recencyDataLoading = false,
  aiThemesLoading = false,
  responsesLoading = false,
  metricsCalculating = false,
  responseTexts = {},
  fetchResponseTexts,
  previousPeriodMetrics = null,
  companyRelevanceByMonth = {},
  previousPeriodResponses = [],
  epsTrend = [],
  epsChange = null,
  epsTrendByJobFunction = {},
  epsChangeByJobFunction = {},
  market = null,
  metricsByJobFunction = {},
  selectedJobFunction = 'all',
  onJobFunctionChange,
}: OverviewTabProps) => {
  const [isEpsDrilldownOpen, setIsEpsDrilldownOpen] = useState(false);
  // Modal states - persisted
  const [selectedCompetitor, setSelectedCompetitor] = usePersistedState<string | null>('overviewTab.selectedCompetitor', null);
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = usePersistedState<boolean>('overviewTab.isCompetitorModalOpen', false);
  const [competitorSnippets, setCompetitorSnippets] = useState<{ snippet: string; full: string }[]>([]);
  const [expandedSnippetIdx, setExpandedSnippetIdx] = useState<number | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string>("");
  const [loadingCompetitorSummary, setLoadingCompetitorSummary] = useState(false);
  const [competitorSummaryError, setCompetitorSummaryError] = useState<string | null>(null);
  const [competitorThinkingStep, setCompetitorThinkingStep] = useState<number>(-1);
  const [competitorThinkingSteps, setCompetitorThinkingSteps] = useState<string[]>([]);
  const [competitorSummarySources, setCompetitorSummarySources] = useState<{ domain: string; url: string | null; displayName: string }[]>([]);
  const [hoveredCompetitorCitation, setHoveredCompetitorCitation] = useState<number | null>(null);
  const [isMentionsDrawerOpen, setIsMentionsDrawerOpen] = usePersistedState<boolean>('overviewTab.isMentionsDrawerOpen', false);
  const [expandedMentionIdx, setExpandedMentionIdx] = useState<number | null>(null);

  // Job function filter — scopes the Sources / Competitors / Themes summary
  // cards. The headline EPS / Breakdown scorecard stays global (it comes from
  // per-company materialized views with no job-function dimension).
  // Controlled by the parent Dashboard so the selection is shared across all
  // tabs (Sources, Competitors, Themes) and never resets on tab switch.
  const selectedJobFunctionFilter = selectedJobFunction;
  const setSelectedJobFunctionFilter = onJobFunctionChange ?? (() => {});

  // Cube pooling dimension for the pill filter: null = all functions,
  // otherwise the job_function_context value verbatim ('' = untagged).
  const cubeJobFunction = selectedJobFunctionFilter === 'all' ? null : selectedJobFunctionFilter;

  const getUniqueJobFunctions = useMemo(() => {
    // Cube path: distinct non-empty functions in the selected quarter.
    if (cubeScopeRows) {
      const fns = new Set<string>();
      cubeScopeRows.forEach(r => {
        if (cubeQuarterKey && quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey) return;
        if (r.job_function_context) fns.add(r.job_function_context);
      });
      return Array.from(fns).sort();
    }
    // Raw fallback: scope stats not yet backfilled.
    const fns = new Set<string>();
    responses.forEach(r => {
      const fn = r.confirmed_prompts?.job_function_context?.trim();
      if (fn) fns.add(fn);
    });
    return Array.from(fns).sort();
  }, [cubeScopeRows, cubeQuarterKey, responses]);

  const fnResponses = useMemo(() => (
    selectedJobFunctionFilter === 'all'
      ? responses
      : responses.filter(r => r.confirmed_prompts?.job_function_context?.trim() === selectedJobFunctionFilter)
  ), [responses, selectedJobFunctionFilter]);

  const fnPreviousResponses = useMemo(() => (
    selectedJobFunctionFilter === 'all'
      ? previousPeriodResponses
      : previousPeriodResponses.filter(r => r.confirmed_prompts?.job_function_context?.trim() === selectedJobFunctionFilter)
  ), [previousPeriodResponses, selectedJobFunctionFilter]);

  const fnThemes = useMemo(() => {
    if (selectedJobFunctionFilter === 'all') return aiThemes;
    const ids = new Set(fnResponses.map(r => r.id));
    return aiThemes.filter(t => ids.has(t.response_id));
  }, [aiThemes, fnResponses, selectedJobFunctionFilter]);

  // Per-response theme counts from company_response_sentiment_mv.
  // Replaces scanning raw aiThemes for the perception-score-over-time chart.
  const responseSentimentMap = useMemo(() => {
    const map = new Map<string, { total: number; positive: number; negative: number }>();
    (responseSentimentRows || []).forEach(row => {
      map.set(row.response_id, {
        total: Number(row.total_themes) || 0,
        positive: Number(row.positive_themes) || 0,
        negative: Number(row.negative_themes) || 0,
      });
    });
    return map;
  }, [responseSentimentRows]);

  const isFunctionFiltered = selectedJobFunctionFilter !== 'all';

  // EPS / Breakdown scorecard values for the selected function. Falls back to
  // the global metrics for "All functions" or if the function has no data.
  const scorecardMetrics = useMemo(() => {
    if (!isFunctionFiltered) return metrics;
    const fn = metricsByJobFunction[selectedJobFunctionFilter];
    return fn ? { ...metrics, ...fn } : metrics;
  }, [metrics, metricsByJobFunction, selectedJobFunctionFilter, isFunctionFiltered]);

  // Responsive check
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Helper function to calculate AI-based sentiment for a response (similar to useDashboardData)
  // Only counts themes from responses that belong to the current company
  const calculateAIBasedSentiment = useMemo(() => {
    // Build a cache of sentiment calculations per response ID
    const cache = new Map<string, { sentiment_score: number; sentiment_label: string }>();
    
    // Create a Set of response IDs from the current company's responses
    // This ensures we only count themes from responses belonging to the current company
    const companyResponseIds = new Set(responses.map(r => r.id));
    
    if (aiThemes.length === 0) {
      // Return a function that always returns neutral if no themes
      return (responseId: string) => {
        return { sentiment_score: 0, sentiment_label: 'neutral' };
      };
    }
    
    // Filter themes to only include those from the current company's responses
    const companyThemes = aiThemes.filter(theme => companyResponseIds.has(theme.response_id));
    
    // Group themes by response_id for efficient processing
    const themesByResponseId = new Map<string, AITheme[]>();
    companyThemes.forEach(theme => {
      if (!themesByResponseId.has(theme.response_id)) {
        themesByResponseId.set(theme.response_id, []);
      }
      themesByResponseId.get(theme.response_id)!.push(theme);
    });
    
    // Calculate sentiment for each response ID once.
    // Methodology v2: positive/(positive+negative) from the text labels;
    // neutral-only responses carry no signal and read as neutral.
    themesByResponseId.forEach((responseThemes, responseId) => {
      const positiveThemes = responseThemes.filter(theme => theme.sentiment === 'positive').length;
      const negativeThemes = responseThemes.filter(theme => theme.sentiment === 'negative').length;
      const sentimentRatio = sentimentRatioV2(positiveThemes, negativeThemes);

      if (sentimentRatio === null) {
        cache.set(responseId, { sentiment_score: 0, sentiment_label: 'neutral' });
        return;
      }

      const sentimentLabel = sentimentRatio > 0.6 ? 'positive' : sentimentRatio < 0.4 ? 'negative' : 'neutral';

      cache.set(responseId, {
        sentiment_score: sentimentRatio,
        sentiment_label: sentimentLabel
      });
    });
    
    // Return a function that looks up from cache
    return (responseId: string) => {
      const cached = cache.get(responseId);
      if (cached) {
        return cached;
      }
      // No AI themes available for this response - return neutral sentiment
      return { sentiment_score: 0, sentiment_label: 'neutral' };
    };
  }, [aiThemes, responses]);




  // Helper for mini-cards — use the same rounded values that feed the EPS formula
  const breakdowns = useMemo(() => [
    {
      title: 'Sentiment',
      value: metrics.sentimentScore,
      trend: metrics.sentimentTrendComparison,
      color: 'green',
      description: 'How positively your brand is perceived based on AI thematic analysis.'
    },
    {
      title: 'Visibility',
      value: metrics.visibilityScore,
      trend: metrics.visibilityTrendComparison,
      color: 'blue',
      description: 'How prominently your brand is mentioned.'
    }
  ], [metrics.sentimentScore, metrics.sentimentTrendComparison, metrics.visibilityScore, metrics.visibilityTrendComparison]);

  // Current vs previous PERIOD (snapshot month), not latest calendar day.
  // `responses` is already scoped to the effective snapshot month by the hook,
  // and `previousPeriodResponses` is the prior month it passes down. The old
  // "latest tested_at day" bucketing broke under the merged multi-profile
  // view: sibling profiles are collected on different days, so the same
  // collection cycle scattered across current/previous and the trend arrows
  // compared one country against the rest of the scope.
  const groupResponsesByTimePeriod = useMemo(() => {
    return { current: fnResponses, previous: fnPreviousResponses };
  }, [fnResponses, fnPreviousResponses]);

  // Calculate time-based competitor data
  const timeBasedCompetitors = useMemo(() => {
    const { current, previous } = groupResponsesByTimePeriod;
    
    // Get competitor counts for current period
    const currentCompetitors: Record<string, number> = {};
    current.forEach(response => {
      if (response.competitor_mentions) {
        const mentions = Array.isArray(response.competitor_mentions) 
          ? response.competitor_mentions 
          : JSON.parse(response.competitor_mentions as string || '[]');
        
        mentions.forEach((mention: any) => {
          if (mention.name) {
            const competitorName = normalizeCompetitorName(mention.name);
            if (competitorName && 
                competitorName.toLowerCase() !== companyName.toLowerCase() &&
                competitorName.length > 1) {
              currentCompetitors[competitorName] = (currentCompetitors[competitorName] || 0) + 1;
            }
          }
        });
      }
    });

    // Get competitor counts for previous period and calculate average
    const previousCompetitors: Record<string, number> = {};
    // "previous" is now one whole snapshot period (not N calendar days), so
    // compare period totals directly rather than averaging over day count.
    const numPreviousDays = 1;

    previous.forEach(response => {
      if (response.competitor_mentions) {
        const mentions = Array.isArray(response.competitor_mentions) 
          ? response.competitor_mentions 
          : JSON.parse(response.competitor_mentions as string || '[]');
        
        mentions.forEach((mention: any) => {
          if (mention.name) {
            const competitorName = normalizeCompetitorName(mention.name);
            if (competitorName && 
                competitorName.toLowerCase() !== companyName.toLowerCase() &&
                competitorName.length > 1) {
              previousCompetitors[competitorName] = (previousCompetitors[competitorName] || 0) + 1;
            }
          }
        });
      }
    });

    // Combine all unique competitors
    const allCompetitors = new Set([
      ...Object.keys(currentCompetitors),
      ...Object.keys(previousCompetitors)
    ]);

    const timeBasedData: TimeBasedData[] = Array.from(allCompetitors).map(competitor => {
      const currentCount = currentCompetitors[competitor] || 0;
      const previousTotalCount = previousCompetitors[competitor] || 0;
      const previousAverage = Math.round(previousTotalCount / numPreviousDays);

      const change = currentCount - previousAverage;
      const changePercent = previousAverage > 0 ? (change / previousAverage) * 100 : currentCount > 0 ? 100 : 0;

      return {
        name: competitor,
        current: currentCount,
        previous: previousAverage,
        change,
        changePercent
      };
    });

    // Sort by current count descending
    const result = timeBasedData
      .sort((a, b) => b.current - a.current)
      .slice(0, 8);

    return result;
  }, [groupResponsesByTimePeriod, companyName]);

  // Calculate all-time citation data with change indicators
  const allTimeCitations = useMemo(() => {
    // Helper to parse citations
    const parseCitations = (citations: any) => {
      if (!citations) return [];
      try {
        return typeof citations === 'string' ? JSON.parse(citations) : citations;
      } catch {
        return [];
      }
    };

    // Get citation counts across all time
    const citationCounts: Record<string, number> = {};
    responses.forEach(response => {
      const citations = parseCitations(response.citations);
      citations.forEach((citation: any) => {
        if (citation.domain) {
          citationCounts[citation.domain] = (citationCounts[citation.domain] || 0) + 1;
        }
      });
    });

    // Convert to array and sort by count descending
    const result = Object.entries(citationCounts)
      .map(([domain, count]) => ({
        name: domain,
        count: count,
        change: 0 // Will be updated after timeBasedCitations is calculated
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return result;
  }, [responses]);

  // Calculate all-time competitor data
  const allTimeCompetitors = useMemo(() => {
    // Get competitor counts across all time
    const competitorCounts: Record<string, number> = {};
    
    responses.forEach(response => {
      if (response.competitor_mentions) {
        const mentions = Array.isArray(response.competitor_mentions) 
          ? response.competitor_mentions 
          : JSON.parse(response.competitor_mentions as string || '[]');
        
        mentions.forEach((mention: any) => {
          if (mention.name) {
            const competitorName = normalizeCompetitorName(mention.name);
            if (competitorName && 
                competitorName.toLowerCase() !== companyName.toLowerCase() &&
                competitorName.length > 1) {
              competitorCounts[competitorName] = (competitorCounts[competitorName] || 0) + 1;
            }
          }
        });
      }
    });

    // Convert to array and sort by count descending
    const result = Object.entries(competitorCounts)
      .map(([competitor, count]) => ({
        name: competitor,
        count: count,
        change: 0 // Will be updated after timeBasedCompetitors is calculated
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return result;
  }, [responses, companyName]);

  // Calculate time-based citation data (keeping for reference)
  const timeBasedCitations = useMemo(() => {
    const { current, previous } = groupResponsesByTimePeriod;
    
    // Helper to parse citations
    const parseCitations = (citations: any) => {
      if (!citations) return [];
      try {
        return typeof citations === 'string' ? JSON.parse(citations) : citations;
      } catch {
        return [];
      }
    };

    // Get citation counts for current period
    const currentCitations: Record<string, number> = {};
    current.forEach(response => {
      const citations = parseCitations(response.citations);
      citations.forEach((citation: any) => {
        if (citation.domain) {
          currentCitations[citation.domain] = (currentCitations[citation.domain] || 0) + 1;
        }
      });
    });

    // Get citation counts for previous period and calculate average
    const previousCitations: Record<string, number> = {};
    // "previous" is now one whole snapshot period (not N calendar days), so
    // compare period totals directly rather than averaging over day count.
    const numPreviousDays = 1;

    previous.forEach(response => {
      const citations = parseCitations(response.citations);
      citations.forEach((citation: any) => {
        if (citation.domain) {
          previousCitations[citation.domain] = (previousCitations[citation.domain] || 0) + 1;
        }
      });
    });

    // Combine all unique domains
    const allDomains = new Set([
      ...Object.keys(currentCitations),
      ...Object.keys(previousCitations)
    ]);

    const timeBasedData: TimeBasedData[] = Array.from(allDomains).map(domain => {
      const currentCount = currentCitations[domain] || 0;
      const previousTotalCount = previousCitations[domain] || 0;
      const previousAverage = Math.round(previousTotalCount / numPreviousDays);

      const change = currentCount - previousAverage;
      const changePercent = previousAverage > 0 ? (change / previousAverage) * 100 : currentCount > 0 ? 100 : 0;

      return {
        name: domain,
        current: currentCount,
        previous: previousAverage,
        change,
        changePercent
      };
    });

    // Sort by current count descending, then by change descending
    const result = timeBasedData
      .sort((a, b) => {
        if (b.current !== a.current) return b.current - a.current;
        return b.change - a.change;
      })
      .slice(0, 8);

    return result;
  }, [groupResponsesByTimePeriod]);

  // Merge change data into all-time competitors
  const allTimeCompetitorsWithChanges = useMemo(() => {
    const changeData = new Map();
    timeBasedCompetitors.forEach(competitor => {
      changeData.set(competitor.name, competitor.change);
    });

    return allTimeCompetitors.map(competitor => ({
      ...competitor,
      change: changeData.get(competitor.name) || 0
    }));
  }, [allTimeCompetitors, timeBasedCompetitors]);

  // Merge change data into all-time citations
  const allTimeCitationsWithChanges = useMemo(() => {
    const changeData = new Map();
    timeBasedCitations.forEach(citation => {
      changeData.set(citation.name, citation.change);
    });

    return allTimeCitations.map(citation => ({
      ...citation,
      change: changeData.get(citation.name) || 0
    }));
  }, [allTimeCitations, timeBasedCitations]);

  // Helper to get time period labels
  const getTimePeriodLabels = () => {
    const { current, previous } = groupResponsesByTimePeriod;
    if (current.length === 0) return { current: 'No data', previous: 'No data' };

    const currentDate = new Date(current[0].tested_at);
    const currentLabel = currentDate.toLocaleDateString();
    
    if (previous.length === 0) {
      return { current: currentLabel, previous: 'No previous data' };
    }
    
    const previousLabel = "Previous Avg.";

    return { current: currentLabel, previous: previousLabel };
  };

  const timeLabels = getTimePeriodLabels();



  // Helper to extract snippets for a competitor from all responses
  const getSnippetsForCompetitor = (competitor: string) => {
    const snippets: { snippet: string; full: string }[] = [];
    // Regex to match competitor name with optional bolding and punctuation after
    const competitorPattern = `(?:\\*\\*|__)?${competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\*\\*|__)?[\\s]*[:*\-]*`;
    const regex = new RegExp(`((?:\\S+\\s+){0,4})(${competitorPattern})`, 'gi');
    responses.forEach(response => {
      if (!response.response_text) return;
      let match;
      while ((match = regex.exec(response.response_text)) !== null) {
        // Get 4 words before
        const before = match[1]?.split(/\s+/).slice(-4).join(' ') || '';
        // Find the index just after the match
        const afterStartIdx = match.index + match[0].length;
        // Take the next 12 words from the remaining text
        const afterText = response.response_text.slice(afterStartIdx).replace(/^([:*\-\s])+/, '');
        const after = afterText.split(/\s+/).slice(0, 12).join(' ');
        snippets.push({
          snippet: `${before} ${match[2]} ${after}`.trim(),
          full: response.response_text
        });
      }
    });
    return snippets;
  };

  const handleCompetitorClick = (competitor: string) => {
    const snippets = getSnippetsForCompetitor(competitor);
    setSelectedCompetitor(competitor);
    setCompetitorSnippets(snippets);
    setIsCompetitorModalOpen(true);
  };

  const handleCloseCompetitorModal = () => {
    setIsCompetitorModalOpen(false);
    setSelectedCompetitor(null);
    setCompetitorSnippets([]);
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setCompetitorThinkingStep(-1);
    setCompetitorThinkingSteps([]);
    setCompetitorSummarySources([]);
    setHoveredCompetitorCitation(null);
  };

  const handleLLMClick = (llm: LLMMentionRanking) => {
    // For now, just show a simple alert or could be expanded later
  };

  const handleExpandSnippet = (idx: number) => {
    setExpandedSnippetIdx(idx === expandedSnippetIdx ? null : idx);
  };

  // Helper to format domain to a human-friendly name
  // For Information Sources chart, show the domain as-is (e.g., example.com, example.ai), no capitalization, but remove www.
  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, ""); // Remove www. if present
  };

  // Normalize and merge topCompetitors by case-insensitive name
  const normalizedTopCompetitors = useMemo(() => {
    const normalizedCompetitorsMap = new Map<string, { company: string; count: number }>();
    topCompetitors.forEach(({ company, count }) => {
      const normalized = company.trim().toLowerCase();
      if (normalizedCompetitorsMap.has(normalized)) {
        normalizedCompetitorsMap.get(normalized)!.count += count;
      } else {
        // Capitalize first letter, rest lowercase for display
        const displayName = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        normalizedCompetitorsMap.set(normalized, { company: displayName, count });
      }
    });
    return Array.from(normalizedCompetitorsMap.values()).sort((a, b) => b.count - a.count);
  }, [topCompetitors]);

  // Helper to get all full responses mentioning a competitor
  const getFullResponsesForCompetitor = (competitor: string) => {
    const competitorPattern = `(?:\\*\\*|__)?${competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\*\\*|__)?[\\s]*[:*\-]*`;
    const regex = new RegExp(competitorPattern, 'i');
    return responses.filter(r => r.response_text && regex.test(r.response_text));
  };

  const fetchCompetitorSummary = async () => {
    if (!selectedCompetitor) return;
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setLoadingCompetitorSummary(true);
    setCompetitorThinkingStep(0);
    setCompetitorThinkingSteps([]);

    const relevantResponses = getFullResponsesForCompetitor(selectedCompetitor);
    if (relevantResponses.length === 0) {
      setCompetitorSummaryError("No responses found for this competitor.");
      setLoadingCompetitorSummary(false);
      setCompetitorThinkingStep(-1);
      return;
    }

    let texts = responseTexts;
    const missingTextIds = relevantResponses.filter(r => !r.response_text && !texts[r.id]).map(r => r.id);
    if (missingTextIds.length > 0 && fetchResponseTexts) {
      texts = await fetchResponseTexts(missingTextIds) || texts;
    }

    // Build numbered source list
    const sourceMap: { domain: string; url: string | null; displayName: string }[] = [];
    const seenDomains = new Set<string>();
    relevantResponses.forEach(r => {
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (Array.isArray(citations)) {
          citations.forEach((c: any) => {
            if (c.domain && !seenDomains.has(c.domain)) {
              seenDomains.add(c.domain);
              sourceMap.push({
                domain: c.domain,
                url: c.url ? extractSourceUrl(c.url) : null,
                displayName: getSourceDisplayName(c.domain),
              });
            }
          });
        }
      } catch { /* skip */ }
    });
    setCompetitorSummarySources(sourceMap);

    const steps = [
      `Reading ${relevantResponses.length} responses mentioning ${selectedCompetitor}...`,
      `Identifying key themes and comparisons...`,
      `Evaluating sentiment across mentions...`,
      `Writing competitive analysis...`,
    ];
    setCompetitorThinkingSteps(steps);

    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < steps.length; i++) {
      stepTimers.push(setTimeout(() => setCompetitorThinkingStep(i), i * 1800));
    }

    const sourcesList = sourceMap.map((s, i) => `[${i + 1}] ${s.displayName} (${s.domain})`).join('\n');

    const prompt = `You are an employer brand analyst. Write a concise, insightful summary comparing how ${selectedCompetitor} is positioned relative to ${companyName} in the talent market.

Available sources:
${sourcesList || 'No sources available'}

Source responses:
${relevantResponses.map((r, i) => {
      let responseSources = '';
      try {
        const citations = typeof r.citations === 'string' ? JSON.parse(r.citations) : r.citations;
        if (Array.isArray(citations)) {
          const domains = [...new Set(citations.map((c: any) => c.domain).filter(Boolean))];
          const indices = domains.map((d: string) => sourceMap.findIndex(s => s.domain === d) + 1).filter((n: number) => n > 0);
          if (indices.length > 0) responseSources = ` [Sources: ${indices.join(', ')}]`;
        }
      } catch { /* skip */ }
      return `${(texts[r.id] || r.response_text || '').slice(0, 800)}${responseSources}`;
    }).join('\n---\n')}

Write 2-3 short paragraphs (no bullet points, no headings). Cover: (1) what stands out about ${selectedCompetitor} and how they differ from ${companyName}, (2) areas where ${selectedCompetitor} is stronger or weaker, (3) what this means for ${companyName}'s talent strategy. Be direct and specific. Do not start with "${selectedCompetitor} is..."

CRITICAL: When you reference information from a source, add an inline citation like [1], [2], etc. matching the source numbers above. Place citations naturally at the end of the relevant sentence or claim. Use citations frequently — every key claim should have one. Only cite sources from the numbered list above.`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setCompetitorSummaryError("Authentication required");
        setLoadingCompetitorSummary(false);
        setCompetitorThinkingStep(-1);
        stepTimers.forEach(clearTimeout);
        return;
      }
      const res = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ prompt, enableWebSearch: false })
      });
      const data = await res.json();
      stepTimers.forEach(clearTimeout);
      if (data.response) {
        setCompetitorSummary(data.response.trim());
      } else {
        setCompetitorSummaryError(data.error || "No summary generated.");
      }
    } catch (err) {
      stepTimers.forEach(clearTimeout);
      setCompetitorSummaryError("Failed to generate summary.");
    } finally {
      setLoadingCompetitorSummary(false);
      setCompetitorThinkingStep(-1);
    }
  };

  // Filtered mentions for drawer
  const filteredMentions = competitorSnippets;

  // Helper to highlight competitor name and remove other bold/italic
  function highlightCompetitor(snippet: string, competitor: string) {
    // Remove all markdown bold/italic except for the competitor name
    // 1. Remove all **text** and __text__ and *text* and _text_ except for competitor
    // 2. Highlight competitor name (case-insensitive, all occurrences)
    // 3. Return as HTML string
    // First, escape competitor for regex
    const competitorEscaped = competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Remove bold/italic markdown except for competitor name
    let clean = snippet
      // Remove **text** and __text__ unless it's the competitor
      .replace(/(\*\*|__)(?!\s*" + competitorEscaped + ")(.*?)\1/g, '$2')
      // Remove *text* and _text_ unless it's the competitor
      .replace(/(\*|_)(?!\s*" + competitorEscaped + ")(.*?)\1/g, '$2');
    // Now highlight competitor name (all case-insensitive occurrences)
    const regex = new RegExp(`(${competitorEscaped})`, 'gi');
    clean = clean.replace(regex, '<span class="bg-yellow-200 font-bold">$1</span>');
    return clean;
  }

  // Aggregate themes by sentiment (including AI themes)
  const themesBySentiment = useMemo(() => {
    const allThemes = { positive: [], neutral: [], negative: [] as string[] };
    
    // Add traditional themes from responses
    responses.forEach(r => {
      if (Array.isArray(r.themes)) {
        r.themes.forEach((t: any) => {
          if (t && t.theme && t.sentiment) {
            if (allThemes[t.sentiment]) {
              allThemes[t.sentiment].push(t.theme);
            }
          }
        });
      }
    });

    // Add AI themes
    aiThemes.forEach(theme => {
      if (allThemes[theme.sentiment]) {
        allThemes[theme.sentiment].push(theme.theme_name);
      }
    });

    // Deduplicate and take top 3 for each
    return {
      positive: Array.from(new Set(allThemes.positive)).slice(0, 3),
      neutral: Array.from(new Set(allThemes.neutral)).slice(0, 3),
      negative: Array.from(new Set(allThemes.negative)).slice(0, 3),
    };
  }, [responses, aiThemes]);

  // Calculate overwhelmingly positive/negative attributes from AI themes
  const attributeInsights = useMemo(() => {
    if (aiThemes.length === 0) return { positive: [], negative: [] };

    // Group themes by attribute
    const attributeGroups: { [key: string]: { positive: AITheme[], negative: AITheme[], neutral: AITheme[] } } = {};

    aiThemes.forEach(theme => {
      if (!attributeGroups[theme.attribute_id]) {
        attributeGroups[theme.attribute_id] = { positive: [], negative: [], neutral: [] };
      }
      attributeGroups[theme.attribute_id][theme.sentiment].push(theme);
    });

    const positiveAttributes: { attribute: string; name: string; themes: AITheme[]; avgScore: number }[] = [];
    const negativeAttributes: { attribute: string; name: string; themes: AITheme[]; avgScore: number }[] = [];

    // Analyze each attribute.
    // Methodology v2: label-based only — an attribute is "overwhelmingly"
    // positive/negative when it has at least 2 polarized themes and at least
    // 70% of the polarized themes lean one way. avgScore carries the v2 ratio
    // (0..1) for sorting; the numeric sentiment_score is not used.
    Object.entries(attributeGroups).forEach(([attributeId, themes]) => {
      const polarized = themes.positive.length + themes.negative.length;
      const ratio = sentimentRatioV2(themes.positive.length, themes.negative.length);

      if (polarized >= 2 && ratio !== null) {
        if (ratio >= 0.7) {
          positiveAttributes.push({
            attribute: attributeId,
            name: themes.positive[0]?.attribute_name || attributeId,
            themes: themes.positive,
            avgScore: ratio
          });
        } else if (ratio <= 0.3) {
          negativeAttributes.push({
            attribute: attributeId,
            name: themes.negative[0]?.attribute_name || attributeId,
            themes: themes.negative,
            avgScore: ratio
          });
        }
      }
    });

    // Sort by v2 ratio (most positive first / most negative first), take top 2
    return {
      positive: positiveAttributes.sort((a, b) => b.avgScore - a.avgScore).slice(0, 2),
      negative: negativeAttributes.sort((a, b) => a.avgScore - b.avgScore).slice(0, 2)
    };
  }, [aiThemes]);

  // Helper to render a simple comparison bar
  const renderComparisonBar = (data: TimeBasedData, maxCurrent: number, isCompetitor: boolean = false) => {
    const barWidth = maxCurrent > 0 ? Math.max((data.current / maxCurrent) * 100, 2) : 2; // Ensure minimum 2% width
    
    // Truncate labels to 15 characters
    const displayName = isCompetitor ? data.name : getSourceDisplayName(data.name);
    const truncatedName = displayName.length > 15 ? displayName.substring(0, 15) + '...' : displayName;
    
    return (
      <div className="flex items-center py-1 hover:bg-gray-50/50 transition-colors cursor-pointer">
        <div className="flex items-center space-x-3 min-w-[200px] truncate">
          {!isCompetitor && (
            <Favicon domain={data.name} />
          )}
          <span className="text-sm font-medium text-gray-900 truncate" title={displayName}>
            {truncatedName}
          </span>
        </div>
        <div className="flex-1 flex items-center gap-2 ml-4">
          <div className="w-[120px] bg-gray-200 rounded-full">
            <div
              className={`h-4 rounded-full transition-all duration-300 ${
                isCompetitor ? 'bg-blue-100' : 'bg-pink-100'
              }`}
              style={{ width: `${barWidth}%`, minWidth: '2px' }}
            />
          </div>
          <div className="flex items-center w-20">
            <span className="text-sm font-semibold text-gray-900 mr-2">
              {data.current}
            </span>
            {data.change !== 0 && (
              <div className={`flex items-center text-xs ${
                data.change > 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {data.change > 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span className="ml-0.5">{Math.abs(data.change)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAllTimeBar = (data: { name: string; count: number; change?: number }, maxCount: number, isCompetitor: boolean = false) => {
    const barWidth = maxCount > 0 ? Math.max((data.count / maxCount) * 100, 2) : 2; // Ensure minimum 2% width
    
    // Truncate labels to 15 characters
    const displayName = isCompetitor ? data.name : getSourceDisplayName(data.name);
    const truncatedName = displayName.length > 15 ? displayName.substring(0, 15) + '...' : displayName;
    
    return (
      <div className="flex items-center py-1 hover:bg-gray-50/50 transition-colors cursor-pointer">
        <div className="flex items-center space-x-3 min-w-[140px] sm:min-w-[200px] truncate">
          {!isCompetitor && (
            <Favicon domain={data.name} />
          )}
          <span className="text-sm font-medium text-gray-900 truncate" title={displayName}>
            {truncatedName}
          </span>
        </div>
        <div className="flex-1 flex items-center gap-2 ml-2 sm:ml-4">
          <div className="w-[80px] sm:w-[120px] bg-gray-200 rounded-full">
            <div
              className={`h-4 rounded-full transition-all duration-300 ${
                isCompetitor ? 'bg-blue-100' : 'bg-pink-100'
              }`}
              style={{ width: `${barWidth}%`, minWidth: '2px' }}
            />
          </div>
          <div className="flex items-center w-16 sm:w-20">
            <span className="text-sm font-semibold text-gray-900">
              {data.count}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Compute perception score trend based on confirmed_prompts and tested_at dates
  // This groups responses by collection period (tested_at) and calculates scores for each period
  const perceptionScoreTrend = useMemo(() => {
    if (!responses || responses.length === 0) return [];
    
    // Helper to parse citations
    const parseCitations = (citations: any) => {
      if (!citations) return [];
      try {
        return typeof citations === 'string' ? JSON.parse(citations) : citations;
      } catch {
        return [];
      }
    };
    
    // Build a map of URL to recency_score for quick lookup
    const recencyMap = new Map<string, number>();
    recencyData.forEach(item => {
      if (item.url && item.recency_score !== null && item.recency_score !== undefined) {
        recencyMap.set(item.url, item.recency_score);
      }
    });
    
    // Step 1: Group responses by tested_at date (collection period) in a
    // single pass — avoids re-filtering the full responses array per date.
    const responsesByDate = new Map<string, any[]>();
    responses.forEach(r => {
      const date = new Date(r.tested_at).toISOString().split('T')[0];
      const bucket = responsesByDate.get(date);
      if (bucket) {
        bucket.push(r);
      } else {
        responsesByDate.set(date, [r]);
      }
    });


    // Step 2: For each collection period, get the latest response per prompt+model combination
    const collectionPeriods = Array.from(responsesByDate.entries()).map(([date, dateResponses]) => {

      // For this collection period, get unique prompt+model combinations
      // This ensures we're comparing the same set of prompts across periods
      const promptModelMap = new Map<string, any>();
      dateResponses.forEach(r => {
        const key = `${r.confirmed_prompt_id}_${r.ai_model}`;
        // Only keep if this is the latest for this prompt+model on this date
        if (!promptModelMap.has(key) || 
            new Date(r.tested_at).getTime() > new Date(promptModelMap.get(key).tested_at).getTime()) {
          promptModelMap.set(key, r);
        }
      });
      
      const periodResponses = Array.from(promptModelMap.values());
      
      // Filter for experience and competitive responses only for score calculation
      const relevantResponses = periodResponses.filter(r => {
        const promptType = r.confirmed_prompts?.prompt_type;
        return promptType === 'experience' ||
               promptType === 'competitive';
      });
      
      // Sentiment (methodology v2): positive/(positive+negative) pooled for
      // this period from the per-response rollup (company_response_sentiment_mv).
      let avgSentiment = 0;
      if (responseSentimentMap.size > 0) {
        let positiveThemes = 0;
        let negativeThemes = 0;
        periodResponses.forEach(r => {
          const s = responseSentimentMap.get(r.id);
          if (s) {
            positiveThemes += s.positive;
            negativeThemes += s.negative;
          }
        });
        avgSentiment = sentimentRatioV2(positiveThemes, negativeThemes) ?? 0;
      }
      // Convert ratio (0-1) to percentage (0-100)
      const normalizedSentiment = Math.max(0, Math.min(100, avgSentiment * 100));
      
      // Calculate visibility (percentage of responses where company was mentioned)
      const mentionedCount = periodResponses.filter(r => r.company_mentioned === true).length;
      const avgVisibility = periodResponses.length > 0 
        ? (mentionedCount / periodResponses.length) * 100 
        : 0;
      
      // Calculate relevance: prefer MV per-month data, fall back to recency data
      const dateMonthKey = `${new Date(date).getFullYear()}-${String(new Date(date).getMonth() + 1).padStart(2, '0')}`;
      let avgRelevance = 0;
      if (companyRelevanceByMonth[dateMonthKey] !== undefined) {
        avgRelevance = companyRelevanceByMonth[dateMonthKey];
      } else {
        // Fallback to recency data (may be empty)
        const periodCitations = periodResponses.flatMap(r => parseCitations(r.citations));
        const recencyScores: number[] = [];
        periodCitations.forEach((citation: any) => {
          const originalUrl = citation.url || citation.link;
          if (originalUrl) {
            const url = extractSourceUrl(originalUrl);
            if (recencyMap.has(url)) {
              recencyScores.push(recencyMap.get(url)!);
            }
          }
        });
        avgRelevance = recencyScores.length > 0
          ? recencyScores.reduce((sum, score) => sum + score, 0) / recencyScores.length
          : 0;
      }
      
      // Round values first so they match what's displayed in the breakdown
      const roundedSentiment = Math.round(normalizedSentiment);
      const roundedVisibility = Math.round(avgVisibility);
      const roundedRelevance = Math.round(avgRelevance);
      
      // Weighted formula: 50% sentiment + 30% visibility + 20% relevance
      // Use rounded values so EPS matches what's shown in the breakdown card
      const perceptionScore = Math.round(
        (roundedSentiment * 0.5) +
        (roundedVisibility * 0.3) +
        (roundedRelevance * 0.2)
      );
      
      
      return {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        fullDate: date,
        score: perceptionScore,
        responseCount: periodResponses.length,
        promptCount: promptModelMap.size,
        sentiment: roundedSentiment,
        visibility: roundedVisibility,
        relevance: roundedRelevance
      };
    });
    
    // Step 3: Sort by date ascending
    const sorted = collectionPeriods.sort((a, b) =>
      new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime()
    );

    return sorted;
  }, [responses, responseSentimentMap, recencyData, companyRelevanceByMonth]);

  // Active per-month EPS trend + delta: the function-scoped series when a
  // function filter is active, otherwise the global series. Both come from the
  // hook and end on the selected period so the last point equals the headline.
  const activeEpsTrend = isFunctionFiltered
    ? (epsTrendByJobFunction?.[selectedJobFunctionFilter] ?? [])
    : epsTrend;
  const activeEpsChange = isFunctionFiltered
    ? (epsChangeByJobFunction?.[selectedJobFunctionFilter] ?? null)
    : epsChange;

  // EPS sparkline data. Uses the active per-month trend so the line spans every
  // month of data and its last point equals the headline EPS. Falls back to a
  // flat line at the current EPS when there's only a single month of data.
  const epsChartData = useMemo(() => {
    if (Array.isArray(activeEpsTrend) && activeEpsTrend.length > 1) {
      return activeEpsTrend;
    }
    return [
      { date: 'Start', score: scorecardMetrics.perceptionScore, responseCount: responses.length },
      { date: 'Today', score: scorecardMetrics.perceptionScore, responseCount: responses.length },
    ];
  }, [activeEpsTrend, scorecardMetrics.perceptionScore, responses.length]);

  // Recharts replays its entry animation whenever the chart data identity
  // changes (filter switches, refetches); only the true first mount should
  // animate, so flip this ref once the first animation completes.
  const hasEpsChartAnimatedRef = useRef(false);

  // Period-over-period EPS delta for the active scope.
  const epsDelta = typeof activeEpsChange === 'number' ? activeEpsChange : null;

  // Prepare chart data for LLM mentions
  const llmMentionChartData = useMemo(() => {
    return llmMentionRankings.map((llm, index) => ({
      name: llm.displayName,
      mentions: llm.mentions,
      color: `hsl(${index * 60}, 70%, 50%)` // Generate different colors
    }));
  }, [llmMentionRankings]);

  // EpsDrilldownSheet props — memoized so every re-render doesn't rescan
  // responses and hand the sheet fresh object identities.
  const discoveryStats = useMemo(() => {
    // Cube path: visibility from the prompt-type cube's discovery rows, top
    // surfaced entities from the competitor cube (both pooled by quarter +
    // job function; the cube dedupes per response and canonicalizes names).
    if (cubePromptTypeRows && competitorStats) {
      let total = 0;
      let mentioned = 0;
      for (const r of cubePromptTypeRows) {
        if (r.prompt_type !== 'discovery') continue;
        if (cubeQuarterKey && quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey) continue;
        if (cubeJobFunction != null && r.job_function_context !== cubeJobFunction) continue;
        total += r.total_responses || 0;
        mentioned += r.mentioned_responses || 0;
      }
      if (total === 0) return null;
      const targetKey = companyName.trim().toLowerCase();
      const pooled = poolCompetitorRows(competitorStats.rows, {
        quarterKey: cubeQuarterKey,
        jobFunction: cubeJobFunction,
        promptType: 'discovery',
      });
      const topEntities = [...pooled.values()]
        .filter(e => e.discoveryMentions > 0 && e.name.trim().toLowerCase() !== targetKey)
        .sort((a, b) => b.discoveryMentions - a.discoveryMentions)
        .slice(0, 5)
        .map(e => ({
          name: e.name,
          mentions: e.discoveryMentions,
          pct: (e.discoveryMentions / total) * 100,
        }));
      return {
        totalResponses: total,
        targetVisibilityPct: (mentioned / total) * 100,
        topEntities,
      };
    }
    // Raw fallback: cubes not yet backfilled. Function-filtered to match the
    // cube path, so the pill has the same effect on both paths.
    return computeDiscoveryStats(fnResponses, companyName);
  }, [cubePromptTypeRows, competitorStats, cubeQuarterKey, cubeJobFunction, fnResponses, companyName]);

  const topJobFunctions = useMemo(() => {
    // Cube path: responses per non-empty function in the selected quarter.
    if (cubeScopeRows) {
      const counts = new Map<string, number>();
      for (const r of cubeScopeRows) {
        if (!r.job_function_context) continue;
        if (cubeQuarterKey && quarterKeyOfMonthStr(String(r.response_month)) !== cubeQuarterKey) continue;
        counts.set(r.job_function_context, (counts.get(r.job_function_context) ?? 0) + (r.total_responses || 0));
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([j, c]) => `${j} (${c})`)
        .join(", ");
    }
    // Raw fallback: scope stats not yet backfilled.
    const counts = new Map<string, number>();
    responses.forEach((r: any) => {
      const jf = r.confirmed_prompts?.job_function_context;
      if (jf) counts.set(jf, (counts.get(jf) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([j, c]) => `${j} (${c})`)
      .join(", ");
  }, [cubeScopeRows, cubeQuarterKey, responses]);

  return (
    <div className="flex flex-col gap-8 w-full">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
        <p className="text-gray-600">
          Get a comprehensive view of {companyName}'s AI perception metrics, performance trends, and key insights.
        </p>
      </div>

      {getUniqueJobFunctions.length > 0 && (
        <div data-tour="job-function-filter">
          <ScrollablePills
            selected={selectedJobFunctionFilter}
            onSelect={setSelectedJobFunctionFilter}
            options={[
              { value: 'all', label: 'All functions' },
              ...getUniqueJobFunctions.map((fn) => ({ value: fn, label: fn })),
            ]}
          />
        </div>
      )}

      <div data-tour="score-row" className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        {/* Perception Score Card */}
        <Card
          data-tour="eps-card"
          className="bg-gray-50/80 border-0 shadow-none rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow duration-200 p-0 relative overflow-hidden h-full min-h-[240px] cursor-pointer"
          onClick={() => setIsEpsDrilldownOpen(true)}
        >
          {/* Top: Score, label, % change */}
          <div className="flex flex-row items-start justify-between px-8 pt-6 pb-1 z-10">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-lg font-bold text-gray-700 tracking-wide">EPS</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 cursor-pointer align-middle">
                        <HelpCircle className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                The Employer Perception Score is an aggregate of sentiment, visibility and competitive scores.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-end gap-3 mb-1 mt-2">
                {metricsCalculating ? (
                  // The score is rollup-derived; while those fetches settle,
                  // skeleton instead of flashing a false 0 / "No Data".
                  <Skeleton className="h-14 w-28" />
                ) : (
                  <>
                    <span className="text-6xl font-extrabold text-gray-900 drop-shadow-sm leading-none">
                      {scorecardMetrics.perceptionScore}
                    </span>
                    {epsDelta !== null && (
                      epsDelta === 0 ? (
                        <span className="ml-4 flex items-center gap-1 text-xl font-semibold text-gray-400" style={{ marginBottom: 6 }}>
                          <Minus className="w-5 h-5" />0
                        </span>
                      ) : (
                        <span
                          className={`ml-4 flex items-center gap-1 text-xl font-semibold ${epsDelta > 0 ? 'text-green-600' : 'text-red-600'}`}
                          style={{ marginBottom: 6 }}
                        >
                          {epsDelta > 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                          {Math.abs(epsDelta)}
                        </span>
                      )
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Badge in top right */}
            <div className="flex items-start">
              {metricsCalculating ? (
                <Skeleton className="h-7 w-20 mt-1 rounded-full" />
              ) : (
                <span className={`px-3 py-1 rounded-full text-base font-semibold mt-1 ${
                  scorecardMetrics.perceptionScore >= 80 ? 'bg-green-100 text-green-800' : scorecardMetrics.perceptionScore >= 65 ? 'bg-blue-100 text-blue-800' : scorecardMetrics.perceptionScore >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                }`}>{scorecardMetrics.perceptionLabel}</span>
              )}
            </div>
          </div>
          {/* Bottom: Chart, visually anchored */}
           <div className="w-full flex-1 flex items-end" style={{ minHeight: 0 }}>
             <div className="w-full" style={{ height: '96px' }}>
               {!metricsCalculating && (
               <ChartContainer config={{ score: { label: "Score", color: "#0DBCBA" } }} className="w-full h-full">
                 <AreaChart
                   data={epsChartData}
                   margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
                 >
                <defs>
                  <linearGradient id="colorPerceptionBg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0DBCBA" stopOpacity={0.32}/>
                    <stop offset="55%" stopColor="#0DBCBA" stopOpacity={0.10}/>
                    <stop offset="100%" stopColor="#0DBCBA" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                {/* Pad the domain so the curve floats with fill beneath it
                    instead of hugging the baseline as a thin sliver. */}
                <YAxis
                  hide
                  domain={[
                    (dataMin: number) => Math.max(0, Math.floor(dataMin) - 6),
                    (dataMax: number) => Math.min(100, Math.ceil(dataMax) + 4),
                  ]}
                />
                 <Area
                   type="natural"
                   dataKey="score"
                   stroke="#0DBCBA"
                   strokeWidth={2.5}
                   fill="url(#colorPerceptionBg)"
                   dot={(props: any) => {
                     const { cx, cy, index } = props;
                     const isLast = index === epsChartData.length - 1;
                     return (
                       <circle
                         key={`eps-dot-${index}`}
                         cx={cx}
                         cy={cy}
                         r={isLast ? 4 : 0}
                         fill="#0DBCBA"
                         stroke="#ffffff"
                         strokeWidth={isLast ? 2 : 0}
                       />
                     );
                   }}
                   activeDot={{ r: 4, fill: '#0DBCBA', stroke: '#ffffff', strokeWidth: 2 }}
                   isAnimationActive={!hasEpsChartAnimatedRef.current}
                   animationDuration={900}
                   onAnimationEnd={() => { hasEpsChartAnimatedRef.current = true; }}
                 />
                 </AreaChart>
               </ChartContainer>
               )}
             </div>
           </div>
        </Card>
        {/* Score Breakdown Card — opens the same EPS drill-down sheet */}
        <Card
          data-tour="eps-breakdown"
          className="bg-white rounded-2xl shadow-sm p-0 hover:shadow-md transition-shadow duration-200 cursor-pointer h-full min-h-[240px] flex flex-col"
          onClick={() => setIsEpsDrilldownOpen(true)}
        >
          <CardHeader className="pb-2 pt-6 px-4 sm:px-8 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg font-bold text-gray-700">Breakdown</CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 cursor-pointer align-middle">
                      <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Click to learn more about each score component
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardHeader>
          <CardContent className="px-4 sm:px-8 pb-4 flex-1 flex flex-col justify-center">
            {metricsCalculating ? (
              // Show loading skeletons while metrics are calculating
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="text-center">
                  <Skeleton className="h-8 w-16 mx-auto mb-2" />
                  <Skeleton className="h-4 w-20 mx-auto" />
                </div>
                <div className="text-center">
                  <Skeleton className="h-8 w-16 mx-auto mb-2" />
                  <Skeleton className="h-4 w-20 mx-auto" />
                </div>
                <div className="text-center">
                  <Skeleton className="h-8 w-16 mx-auto mb-2" />
                  <Skeleton className="h-4 w-20 mx-auto" />
                </div>
              </div>
            ) : (() => {
              // Breakdown deltas share the EPS sparkline's source: the previous
              // point of the active per-month trend. This keeps all three
              // components consistent with each other and with the headline EPS
              // delta, and makes them work under the function filter too —
              // unlike the old path, which sourced each component differently
              // (sentiment/relevance from MVs that may lack a prior month,
              // visibility recomputed) so only some ever resolved.
              const prevPoint = activeEpsTrend.length >= 2 ? activeEpsTrend[activeEpsTrend.length - 2] : null;
              const hasPrevSentiment = !!prevPoint;
              const hasPrevVisibility = !!prevPoint;
              const hasPrevRelevance = !!prevPoint;

              const sentimentChange = prevPoint ? scorecardMetrics.sentimentScore - prevPoint.sentiment : 0;
              const visibilityChange = prevPoint ? scorecardMetrics.visibilityScore - prevPoint.visibility : 0;
              const relevanceChange = prevPoint ? scorecardMetrics.relevanceScore - prevPoint.relevance : 0;

              const currentSentiment = scorecardMetrics.sentimentScore;
              const currentVisibility = scorecardMetrics.visibilityScore;
              const currentRelevance = scorecardMetrics.relevanceScore;
              
              return (
                <>
            <div className="flex items-center gap-2 sm:gap-3 mb-6">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Sentiment</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${currentSentiment}%` }} />
              </div>
                    <div className="flex items-center gap-1 ml-1 sm:ml-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{currentSentiment}%</span>
                      <span className="w-[40px] flex justify-end">
                        {hasPrevSentiment && (sentimentChange !== 0 ? (
                          <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                            sentimentChange > 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {sentimentChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
                            {sentimentChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                            <span className="whitespace-nowrap">{Math.abs(sentimentChange)}</span>
                          </span>
                        ) : <span className="text-xs text-gray-400">-</span>)}
                      </span>
                    </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 mb-6">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Visibility</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${currentVisibility}%` }} />
              </div>
                    <div className="flex items-center gap-1 ml-1 sm:ml-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{currentVisibility}%</span>
                      <span className="w-[40px] flex justify-end">
                        {hasPrevVisibility && (visibilityChange !== 0 ? (
                          <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                            visibilityChange > 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {visibilityChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
                            {visibilityChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                            <span className="whitespace-nowrap">{Math.abs(visibilityChange)}</span>
                          </span>
                        ) : <span className="text-xs text-gray-400">-</span>)}
                      </span>
                    </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Relevance</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${currentRelevance}%` }} />
              </div>
                    <div className="flex items-center gap-1 ml-1 sm:ml-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{currentRelevance}%</span>
                      <span className="w-[40px] flex justify-end">
                        {hasPrevRelevance && (relevanceChange !== 0 ? (
                          <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                            relevanceChange > 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {relevanceChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
                            {relevanceChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                            <span className="whitespace-nowrap">{Math.abs(relevanceChange)}</span>
                          </span>
                        ) : <span className="text-xs text-gray-400">-</span>)}
                      </span>
            </div>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards Grid - only render when all metrics (including themes) are ready */}
      {!metricsCalculating && (
      <div className="space-y-3">
        <div data-tour="summary-row" className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          <div>
            <SourcesSummaryCard
              topCitations={topCitations}
              responses={fnResponses}
              companyName={companyName}
              searchResults={searchResults}
              perceptionScoreTrend={perceptionScoreTrend}
              previousPeriodResponses={fnPreviousResponses}
              responsesLoading={responsesLoading}
              domainStatsRows={domainStats?.rows}
              cubeScopeRows={cubeScopeRows}
              cubeQuarterKey={cubeQuarterKey}
              cubePrevQuarterKey={cubePrevQuarterKey}
              selectedJobFunction={selectedJobFunction}
            />
          </div>

          <div>
            <CompetitorsSummaryCard
              topCompetitors={normalizedTopCompetitors}
              responses={fnResponses}
              companyName={companyName}
              searchResults={searchResults}
              perceptionScoreTrend={perceptionScoreTrend}
              previousPeriodResponses={fnPreviousResponses}
              responsesLoading={responsesLoading}
              competitorStatsRows={competitorStats?.rows}
              cubePromptTypeRows={cubePromptTypeRows}
              cubeQuarterKey={cubeQuarterKey}
              cubePrevQuarterKey={cubePrevQuarterKey}
              selectedJobFunction={selectedJobFunction}
            />
          </div>

          <div className="lg:col-span-2 xl:col-span-1">
            <AttributesSummaryCard
              aiThemes={fnThemes}
              attributeThemes={attributeThemes}
              companyName={companyName}
              perceptionScoreTrend={perceptionScoreTrend}
              previousPeriodResponses={fnPreviousResponses}
              responses={fnResponses}
              aiThemesLoading={aiThemesLoading}
            />
          </div>
        </div>
      </div>
      )}







      {/* Competitor Panel (slide from right) */}
      <Sheet open={isCompetitorModalOpen} onOpenChange={(open) => { if (!open) handleCloseCompetitorModal(); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0 [&>button]:hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <span>Mentions of {selectedCompetitor}</span>
              <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
            </SheetTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* AI Summary — on demand */}
          <div className="mb-4">
            {competitorSummary ? (
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
                      onClick={fetchCompetitorSummary}
                      disabled={loadingCompetitorSummary}
                      className="text-xs text-gray-400 hover:text-gray-600 h-auto py-1"
                    >
                      {loadingCompetitorSummary ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Regenerate
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-gray-800 text-sm leading-relaxed">
                    {competitorSummary.split('\n\n').filter(Boolean).map((paragraph, pIdx) => {
                      const parts = paragraph.split(/(\[\d+\])/g);
                      return (
                        <p key={pIdx} className="mb-3 last:mb-0">
                          {parts.map((part, partIdx) => {
                            const citationMatch = part.match(/^\[(\d+)\]$/);
                            if (citationMatch) {
                              const num = parseInt(citationMatch[1], 10);
                              const source = competitorSummarySources[num - 1];
                              if (!source) return <span key={partIdx}>{part}</span>;
                              return (
                                <span key={partIdx} className="relative inline-block">
                                  <button
                                    className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-blue-600 bg-blue-100 hover:bg-blue-200 rounded-full cursor-pointer align-super transition-colors ml-0.5"
                                    onMouseEnter={() => setHoveredCompetitorCitation(num)}
                                    onMouseLeave={() => setHoveredCompetitorCitation(null)}
                                    onClick={() => { if (source.url) window.open(source.url, '_blank', 'noopener,noreferrer'); }}
                                  >
                                    {num}
                                  </button>
                                  {hoveredCompetitorCitation === num && (
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 whitespace-nowrap bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 pointer-events-none">
                                      <img src={getFavicon(source.domain)} alt="" className="w-4 h-4 rounded" style={{ background: '#fff' }} />
                                      <span>{source.displayName}</span>
                                      <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
                                    </span>
                                  )}
                                </span>
                              );
                            }
                            return <span key={partIdx}>{part}</span>;
                          })}
                        </p>
                      );
                    })}
                  </div>
                  {competitorSummarySources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-[#0DBCBA]/30">
                      {competitorSummarySources.map((source, index) => (
                        <button
                          key={index}
                          onClick={() => { if (source.url) window.open(source.url, '_blank', 'noopener,noreferrer'); }}
                          className={`inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 pl-1 pr-2 py-1 rounded-full text-xs text-gray-600 transition-colors border border-gray-200 ${source.url ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-blue-600 bg-blue-100 rounded-full flex-shrink-0">{index + 1}</span>
                          <img src={getFavicon(source.domain)} alt="" className="w-3.5 h-3.5 rounded" style={{ background: '#fff', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                          <span>{source.displayName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : loadingCompetitorSummary ? (
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
                    {competitorThinkingSteps.map((step, i) => {
                      const isActive = i === competitorThinkingStep;
                      const isComplete = i < competitorThinkingStep;
                      const isPending = i > competitorThinkingStep;
                      return (
                        <div key={i} className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-500 ${isActive ? 'bg-[#0DBCBA]/15' : ''}`}
                          style={{ opacity: isPending ? 0.3 : 1, transform: isPending ? 'translateX(4px)' : 'translateX(0)', transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                            {isComplete ? <CheckCircle2 className="w-3.5 h-3.5 text-[#0DBCBA]" /> : isActive ? <Loader2 className="w-3.5 h-3.5 text-[#0DBCBA] animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />}
                          </div>
                          <span className={`text-xs transition-colors duration-300 ${isActive ? 'text-[#0A8B89] font-medium' : isComplete ? 'text-[#0DBCBA]' : 'text-gray-400'}`}>{step}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 h-1 bg-[#0DBCBA]/20 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#0DBCBA] to-[#0A8B89] rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${competitorThinkingSteps.length > 0 ? ((competitorThinkingStep + 1) / competitorThinkingSteps.length) * 100 : 0}%` }} />
                  </div>
                </CardContent>
              </Card>
            ) : competitorSummaryError ? (
              <Card className="border-red-100 bg-red-50/30">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-red-600 text-sm">{competitorSummaryError}</span>
                    <Button variant="ghost" size="sm" onClick={fetchCompetitorSummary} className="text-xs">Retry</Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
          {/* View All Mentions Button */}
          <button
            className="w-full mt-2 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold"
            onClick={() => setIsMentionsDrawerOpen(true)}
            disabled={competitorSnippets.length === 0}
          >
            View All Mentions
          </button>

          </div>

          {/* Floating Ask AI button — bottom right of panel */}
          {!competitorSummary && !loadingCompetitorSummary && !competitorSummaryError && (
            <div className="absolute bottom-6 right-6 z-10 animate-slideUpGlow rounded-full">
              <button
                onClick={fetchCompetitorSummary}
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

      {/* Mentions Drawer Modal */}
      <Dialog open={isMentionsDrawerOpen} onOpenChange={setIsMentionsDrawerOpen}>
        <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0">
          <div className="flex items-center gap-2 px-6 py-4 border-b">
            <DialogTitle className="text-lg font-semibold">All Mentions of {selectedCompetitor}</DialogTitle>
            <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
          </div>
          <div className="px-6 py-3 border-b bg-gray-50">
            {/* Search input removed as requested */}
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-white">
            {filteredMentions.length > 0 ? (
              filteredMentions.map((item, idx) => {
                // Show only first 2 lines unless expanded
                const lines = item.snippet.split(/\n|\r/);
                const isExpanded = expandedMentionIdx === idx;
                const preview = lines.slice(0, 2).join(' ');
                const rest = lines.slice(2).join(' ');
                return (
                  <div key={idx} className="p-3 bg-gray-50 rounded border text-sm text-gray-800">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: highlightCompetitor(isExpanded ? item.snippet : preview, selectedCompetitor || "")
                      }}
                    />
                    {lines.length > 2 && (
                      <button
                        className="text-xs text-blue-600 underline mt-1 hover:text-blue-800"
                        onClick={() => setExpandedMentionIdx(isExpanded ? null : idx)}
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-gray-500 text-sm">No mentions found.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>


      {/* Kept mounted while closed: conditionally mounting on `open` would
          unmount the radix Sheet mid-close and skip its slide-out animation.
          Gating the sheet's data hooks on `open` lives in the sheet itself. */}
      <EpsDrilldownSheet
        open={isEpsDrilldownOpen}
        onOpenChange={setIsEpsDrilldownOpen}
        score={metrics.perceptionScore}
        label={metrics.perceptionLabel}
        companyName={companyName}
        market={market}
        liveSentiment={metrics.sentimentScore}
        liveVisibility={metrics.visibilityScore}
        discoveryStats={discoveryStats}
        topJobFunctions={topJobFunctions}
      />
    </div>
  );
});
OverviewTab.displayName = 'OverviewTab';
