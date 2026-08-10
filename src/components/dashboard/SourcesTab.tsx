import { useState, useMemo, useEffect, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CitationCount } from "@/types/dashboard";
import {
  FileText, TrendingUp, TrendingDown, Info, ExternalLink, ChartLine, BarChartHorizontal,
  Search, Tags, HelpCircle, Globe, Bot, SmilePlus,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Favicon } from "@/components/ui/favicon";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePersistedState } from "@/hooks/usePersistedState";
import { enhanceCitations, normalizePageKey, getFavicon } from "@/utils/citationUtils";
import { getLLMDisplayName } from "@/config/llmLogos";
import { getAttributeIconByName } from "@/config/attributeIcons";
import { categorizeSourceByMediaType } from "@/utils/sourceConfig";
import { sentimentRatioV2 } from "@/lib/sentimentV2";
import LLMLogo from "@/components/LLMLogo";
import { ScrollablePills } from "./ScrollablePills";
import { FilterDropdown } from "./FilterDropdown";
import { useTabSearchSeed } from "@/contexts/TabSearchSeedContext";

interface SourcesTabProps {
  topCitations: CitationCount[];
  responses: any[];
  parseCitations: (citations: any) => any[];
  companyName?: string;
  searchResults?: any[];
  currentCompanyId?: string;
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  previousPeriodResponses?: any[];
  // True while the raw response stream for the current company is still
  // arriving (it loads AFTER first paint). Gates the empty state: skeleton
  // rows, never "No citations found yet", until the stream is final.
  responsesLoading?: boolean;
  // Global job-function filter, shared across all dashboard tabs and owned by
  // the parent Dashboard so a selection persists when switching tabs.
  selectedJobFunction?: string;
  onJobFunctionChange?: (value: string) => void;
  // Per-response sentiment rollup rows (company_response_sentiment_mv) —
  // powers the Sentiment column of the cited-pages table.
  responseSentimentRows?: any[];
}

// Helper function to normalize domains for consistent counting
const normalizeDomain = (domain: string): string => {
  if (!domain) return '';
  return domain.trim().toLowerCase().replace(/^www\./, '');
};

// Trend-line series palette — brand teal first, then hues validated for
// CVD-safe adjacency on the white surface (dataviz six-checks). Fixed order.
const CHART_COLORS = ['#0DBCBA', '#5B7FD9', '#DB5E89', '#E8A33D', '#8B5CF6'];
const TREND_SERIES_LIMIT = 5;
// The mentioned/not-mentioned split colors used by the domain-list bars.
const MENTIONED_COLOR = '#0DBCBA';
const NOT_MENTIONED_COLOR = '#D1D5DB';
// Horizontal ranking (bar mode) row count and bar thickness.
const BAR_RANK_LIMIT = 8;
const RANK_BAR_SIZE = 18;
// How many domain rows render before the "Show all" opt-in (each row mounts a
// Favicon image; keeping the initial DOM small keeps the tab snappy at
// Netflix-scale source counts).
const INITIAL_DOMAIN_LIMIT = 50;
// Cited-pages table pagination: initial rows + increment per "Show more".
const INITIAL_PAGE_ROWS = 10;
const PAGE_ROWS_STEP = 50;

// Filter vocabularies, in the order they read best in a dropdown.
const SOURCE_TYPE_ORDER = ['owned', 'influenced', 'organic', 'competitive', 'irrelevant'];
const SENTIMENT_ORDER = ['positive', 'neutral', 'negative'];
type SentimentBucket = 'positive' | 'neutral' | 'negative';

// ---------------------------------------------------------------------------
// Focus-chart platform groups (row 2's three small charts). Grouping is by
// PLATFORM, not raw domain, so fr.glassdoor.com, glassdoor.de and
// glassdoor.com read as one Glassdoor row. A bare token ("glassdoor") matches
// the name as a whole domain label in any position — never as a substring, so
// "monster.com" is listed as a dotted token rather than "monster" catching
// monsterenergy.com. A dotted token ("youtu.be") matches that exact domain or
// a subdomain of it.
// ---------------------------------------------------------------------------
type PlatformGroup = {
  name: string;      // display name for the row
  canonical: string; // domain whose logo represents the platform
  tokens: string[];
};

const EMPLOYER_REVIEW_PLATFORMS: PlatformGroup[] = [
  { name: 'Glassdoor', canonical: 'glassdoor.com', tokens: ['glassdoor'] },
  { name: 'Indeed', canonical: 'indeed.com', tokens: ['indeed'] },
  { name: 'AmbitionBox', canonical: 'ambitionbox.com', tokens: ['ambitionbox'] },
  { name: 'Kununu', canonical: 'kununu.com', tokens: ['kununu'] },
  { name: 'Comparably', canonical: 'comparably.com', tokens: ['comparably'] },
  { name: 'Blind', canonical: 'teamblind.com', tokens: ['teamblind'] },
  { name: 'Fishbowl', canonical: 'fishbowlapp.com', tokens: ['fishbowlapp'] },
  { name: 'Levels.fyi', canonical: 'levels.fyi', tokens: ['levels.fyi'] },
  { name: 'The Muse', canonical: 'themuse.com', tokens: ['themuse'] },
  { name: 'Seek', canonical: 'seek.com.au', tokens: ['seek'] },
  { name: 'Great Place to Work', canonical: 'greatplacetowork.com', tokens: ['greatplacetowork'] },
  { name: 'Built In', canonical: 'builtin.com', tokens: ['builtin'] },
  { name: 'Vault', canonical: 'vault.com', tokens: ['vault.com'] },
  { name: 'FairyGodBoss', canonical: 'fairygodboss.com', tokens: ['fairygodboss'] },
  { name: 'CareerBliss', canonical: 'careerbliss.com', tokens: ['careerbliss'] },
  { name: 'InHerSight', canonical: 'inhersight.com', tokens: ['inhersight'] },
  { name: 'JobCase', canonical: 'jobcase.com', tokens: ['jobcase'] },
  { name: 'WayUp', canonical: 'wayup.com', tokens: ['wayup'] },
  { name: 'Zippia', canonical: 'zippia.com', tokens: ['zippia'] },
  { name: 'ZipRecruiter', canonical: 'ziprecruiter.com', tokens: ['ziprecruiter'] },
  { name: 'Monster', canonical: 'monster.com', tokens: ['monster.com'] },
  { name: 'CareerBuilder', canonical: 'careerbuilder.com', tokens: ['careerbuilder'] },
  { name: 'SimplyHired', canonical: 'simplyhired.com', tokens: ['simplyhired'] },
  { name: 'Dice', canonical: 'dice.com', tokens: ['dice.com'] },
  { name: 'Naukri', canonical: 'naukri.com', tokens: ['naukri'] },
  { name: 'JobStreet', canonical: 'jobstreet.com', tokens: ['jobstreet'] },
  { name: 'StepStone', canonical: 'stepstone.de', tokens: ['stepstone'] },
  { name: 'Welcome to the Jungle', canonical: 'welcometothejungle.com', tokens: ['welcometothejungle'] },
  { name: 'The Job Crowd', canonical: 'thejobcrowd.com', tokens: ['thejobcrowd'] },
  { name: 'Rate My Employer', canonical: 'ratemyemployer.com', tokens: ['ratemyemployer'] },
];

const SOCIAL_PLATFORMS: PlatformGroup[] = [
  { name: 'LinkedIn', canonical: 'linkedin.com', tokens: ['linkedin'] },
  { name: 'Reddit', canonical: 'reddit.com', tokens: ['reddit'] },
  { name: 'YouTube', canonical: 'youtube.com', tokens: ['youtube', 'youtu.be'] },
  { name: 'X (Twitter)', canonical: 'x.com', tokens: ['x.com', 'twitter'] },
  { name: 'Facebook', canonical: 'facebook.com', tokens: ['facebook', 'fb.com'] },
  { name: 'Instagram', canonical: 'instagram.com', tokens: ['instagram'] },
  { name: 'TikTok', canonical: 'tiktok.com', tokens: ['tiktok'] },
  { name: 'Quora', canonical: 'quora.com', tokens: ['quora'] },
  { name: 'Medium', canonical: 'medium.com', tokens: ['medium.com'] },
  { name: 'Threads', canonical: 'threads.net', tokens: ['threads'] },
  { name: 'Pinterest', canonical: 'pinterest.com', tokens: ['pinterest'] },
  { name: 'Discord', canonical: 'discord.com', tokens: ['discord'] },
  { name: 'Snapchat', canonical: 'snapchat.com', tokens: ['snapchat'] },
  { name: 'Bluesky', canonical: 'bsky.app', tokens: ['bsky.app', 'bluesky'] },
  { name: 'Tumblr', canonical: 'tumblr.com', tokens: ['tumblr'] },
  { name: 'Mastodon', canonical: 'mastodon.social', tokens: ['mastodon'] },
];

const domainMatchesPlatformToken = (domain: string, token: string): boolean => {
  if (token.includes('.')) {
    return domain === token || domain.endsWith(`.${token}`);
  }
  return (
    domain === token ||
    domain.startsWith(`${token}.`) ||   // glassdoor.com, glassdoor.in
    domain.includes(`.${token}.`) ||    // fr.glassdoor.com
    domain.endsWith(`.${token}`)
  );
};

// Rows per focus chart. Six keeps the three cards level with each other and
// scannable; the full ranking lives in the domain list above.
const FOCUS_ROW_LIMIT = 6;

// When several URL variants collapse into one page (highlight fragments,
// tracking params), show the cleanest one: no #fragment, then shortest.
const preferDisplayUrl = (a: string, b: string): string => {
  const aHash = a.includes('#');
  const bHash = b.includes('#');
  if (aHash !== bHash) return aHash ? b : a;
  return a.length <= b.length ? a : b;
};

// Some stored citation titles contain literal "&"-style escapes (JSON
// escaping survived as text). Decode them so titles render as "&" etc.
const decodeUnicodeEscapes = (s: string): string => {
  if (!s || !s.includes('\\u')) return s;
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
};

// URL shown to the user: no protocol, no www, no trailing slash.
const formatDisplayUrl = (url: string): string =>
  url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// Fallback page title when the citation carried none: the readable path.
const titleFromUrl = (url: string, domain: string): string => {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
    return path && path !== '' ? `${domain}${path}` : domain;
  } catch {
    return domain;
  }
};

type TrendGranularity = 'week' | 'month';

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

export const SourcesTab = memo(({ topCitations, responses, parseCitations, companyName, searchResults = [], currentCompanyId, responseTexts = {}, fetchResponseTexts, previousPeriodResponses = [], responsesLoading = false, selectedJobFunction = 'all', onJobFunctionChange, responseSentimentRows = [] }: SourcesTabProps) => {

  // Responses arrive already scoped by useDashboardData (brand scope — the
  // current company plus same-name sibling profiles — with the location and
  // period filters applied). Re-filtering by currentCompanyId here would drop
  // the sibling profiles' rows from the aggregated view.
  const filteredResponses = responses;

  const filteredSearchResults = useMemo(() => {
    if (!currentCompanyId) return searchResults;
    return searchResults.filter(result => result.company_id === currentCompanyId);
  }, [searchResults, currentCompanyId]);

  // -----------------------------------------------------------------------
  // SINGLE-PASS CITATION NORMALIZATION
  //
  // For orgs like Netflix (~38K responses × ~6 citations each), parsing the
  // citations jsonb is by far the heaviest client-side work on this tab. We
  // do the parse ONCE per response here and hand every downstream consumer a
  // cheap precomputed shape: cited domains, cited pages (normalized URL
  // keys), and the response's model/theme/timestamp.
  // -----------------------------------------------------------------------
  type PageCitation = {
    key: string;    // normalized page key (domain + path)
    url: string;    // best display URL seen for this page
    title: string;
    domain: string; // normalized domain, for the source modal + favicon
  };

  type NormalizedResponse = {
    raw: any;
    id: string;
    company_mentioned: boolean;
    theme: string | undefined;
    promptType: string | undefined;
    jobFunction: string | null;
    model: string;
    // Epoch ms of tested_at (fallback created_at); null when unparseable.
    testedAt: number | null;
    // Normalized, deduplicated website domains cited by this response.
    domains: string[];
    // Unique cited pages (deduplicated by normalized page key).
    pages: PageCitation[];
  };

  const normalizeResponsesOnce = (input: any[]): NormalizedResponse[] => {
    return input.map((r) => {
      let parsed: any = r.citations;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      const arr = Array.isArray(parsed) ? enhanceCitations(parsed) : [];
      const seenDomains = new Set<string>();
      const seenPages = new Set<string>();
      const domains: string[] = [];
      const pages: PageCitation[] = [];
      for (const c of arr) {
        if (c.type !== 'website' || !c.domain) continue;
        const d = normalizeDomain(c.domain);
        if (!d) continue;
        if (!seenDomains.has(d)) {
          seenDomains.add(d);
          domains.push(d);
        }
        if (c.url) {
          const key = normalizePageKey(c.url);
          if (key && !seenPages.has(key)) {
            seenPages.add(key);
            pages.push({ key, url: c.url, title: c.title || '', domain: d });
          }
        }
      }
      const tsRaw = r.tested_at || r.created_at;
      const ts = tsRaw ? Date.parse(tsRaw) : NaN;
      return {
        raw: r,
        id: r.id,
        company_mentioned: r.company_mentioned === true,
        theme: r.confirmed_prompts?.prompt_theme,
        promptType: r.confirmed_prompts?.prompt_type,
        jobFunction: r.confirmed_prompts?.job_function_context?.trim() || null,
        model: r.ai_model || '',
        testedAt: Number.isFinite(ts) ? ts : null,
        domains,
        pages,
      };
    });
  };

  const normalizedResponses = useMemo<NormalizedResponse[]>(
    () => normalizeResponsesOnce(filteredResponses),
    [filteredResponses],
  );

  const normalizedPrevResponses = useMemo<NormalizedResponse[]>(
    () => normalizeResponsesOnce(previousPeriodResponses),
    [previousPeriodResponses],
  );

  // Reverse index: domain → responses that cite it. Powers the source modal
  // (which needs the raw rows behind a domain) in O(1) per click.
  const responsesByDomain = useMemo(() => {
    const map = new Map<string, NormalizedResponse[]>();
    for (const nr of normalizedResponses) {
      for (const d of nr.domains) {
        const list = map.get(d);
        if (list) list.push(nr);
        else map.set(d, [nr]);
      }
    }
    return map;
  }, [normalizedResponses]);

  // Same reverse index for the PREVIOUS period. Used to hand the source modal
  // the prior-period rows for a domain so it can compute per-page trends
  // (which specific URLs drove the source's increase/decrease).
  const prevResponsesByDomain = useMemo(() => {
    const map = new Map<string, NormalizedResponse[]>();
    for (const nr of normalizedPrevResponses) {
      for (const d of nr.domains) {
        const list = map.get(d);
        if (list) list.push(nr);
        else map.set(d, [nr]);
      }
    }
    return map;
  }, [normalizedPrevResponses]);

  // response_id → sentiment ratio (positive/(positive+negative), null = the
  // response had themes but none polarized). Same formula as the rest of the
  // dashboard (methodology v2).
  const sentimentById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of responseSentimentRows) {
      if (!row?.response_id) continue;
      let ratio: number | null;
      if (row.sentiment_ratio === null || row.sentiment_ratio === undefined) {
        ratio = sentimentRatioV2(Number(row.positive_themes) || 0, Number(row.negative_themes) || 0);
      } else {
        const n = typeof row.sentiment_ratio === 'number' ? row.sentiment_ratio : Number(row.sentiment_ratio);
        ratio = Number.isFinite(n) ? n : null;
      }
      map.set(row.response_id, ratio);
    }
    return map;
  }, [responseSentimentRows]);

  // Modal states - persisted
  const [selectedSource, setSelectedSource] = usePersistedState<CitationCount | null>('sourcesTab.selectedSource', null);
  const [isSourceModalOpen, setIsSourceModalOpen] = usePersistedState<boolean>('sourcesTab.isSourceModalOpen', false);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [visiblePageRows, setVisiblePageRows] = useState(INITIAL_PAGE_ROWS);
  // Cited-pages toolbar. Empty array = filter inactive (all rows pass).
  const [pageSearch, setPageSearch] = useState('');
  const [filterAttributes, setFilterAttributes] = useState<string[]>([]);
  const [filterQuestionTypes, setFilterQuestionTypes] = useState<string[]>([]);
  const [filterSourceTypes, setFilterSourceTypes] = useState<string[]>([]);
  const [filterModels, setFilterModels] = useState<string[]>([]);
  const [filterSentiments, setFilterSentiments] = useState<string[]>([]);
  // Chart form toggle for the trends card - persisted. 'bar' = horizontal
  // ranking for the current month (the default); 'line' = trend over time.
  const [trendChartType, setTrendChartType] = usePersistedState<'line' | 'bar'>('sourcesTab.trendChartType', 'bar');
  // Controlled by the parent Dashboard so the job-function selection is shared
  // across all tabs and never resets on tab switch.
  const selectedJobFunctionFilter = selectedJobFunction;
  const setSelectedJobFunctionFilter = onJobFunctionChange ?? (() => {});

  // Clear persisted "unknown" source so we never open the modal with unknown
  // (domains are now derived from URLs).
  useEffect(() => {
    if (selectedSource?.domain && normalizeDomain(selectedSource.domain) === 'unknown') {
      setSelectedSource(null);
      setIsSourceModalOpen(false);
    }
  }, [selectedSource?.domain]);

  const handleSourceClick = (citation: CitationCount) => {
    setSelectedSource(citation);
    setIsSourceModalOpen(true);
  };

  // Open a domain's source modal by name — used by every chart affordance
  // (bars, axis labels, legend) so they all behave like the list rows.
  // Only ever called from event handlers, so reading `analyzed` (declared
  // below) is safe: it's initialized long before any click lands.
  const openDomainModal = (domain: string) => {
    const d = normalizeDomain(domain);
    if (!d) return;
    handleSourceClick({ domain: d, count: analyzed.domainCounts.get(d) || 0 });
  };

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  // Picking a source in the global command palette lands here. This tab has no
  // search box of its own (the palette IS the search), so the seed opens that
  // domain's detail modal directly.
  useTabSearchSeed('sources', (domain: string) => {
    const d = normalizeDomain(domain);
    if (!d) return;
    setSelectedSource({ domain: d, count: 0 });
    setIsSourceModalOpen(true);
  });

  // Helper function to get unique job function contexts from responses
  const getUniqueJobFunctions = useMemo(() => {
    const jobFunctions = new Set<string>();
    filteredResponses.forEach(response => {
      const jobFunctionContext = response.confirmed_prompts?.job_function_context?.trim();
      if (jobFunctionContext) {
        jobFunctions.add(jobFunctionContext);
      }
    });
    return Array.from(jobFunctions).sort();
  }, [filteredResponses]);

  const getResponsesForSource = (domain: string) => {
    const list = responsesByDomain.get(normalizeDomain(domain));
    return list ? list.map((nr) => nr.raw) : [];
  };

  // Previous-period rows citing a domain — powers the modal's Trending tab.
  const getPrevResponsesForSource = (domain: string) => {
    const list = prevResponsesByDomain.get(normalizeDomain(domain));
    return list ? list.map((nr) => nr.raw) : [];
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, "");
  };

  // Does a response belong in the currently-analyzed set? Shared basis for
  // domain counts, page counts, the trend chart and the coverage denominator,
  // so every number on the page describes the same subset. Mentioned and
  // not-mentioned responses are BOTH analyzed — the split is shown per row
  // instead of behind a toggle.
  const responseMatchesFilters = useCallback((nr: NormalizedResponse) => {
    if (selectedJobFunctionFilter !== 'all' && nr.jobFunction !== selectedJobFunctionFilter) return false;
    return true;
  }, [selectedJobFunctionFilter]);

  type PageAgg = {
    key: string;
    url: string;
    title: string;
    domain: string;
    count: number;          // responses citing this page
    mentionedCount: number; // …of which mention the company
    themeCounts: Map<string, number>;
    models: Set<string>;    // raw ai_model values
    ratioSum: number;       // sum of sentiment ratios over responses with signal
    ratioCount: number;
  };

  // ONE pass over the current-period responses producing the domain-level view
  // (counts + mentioned split) and the matching subset, which the chart and
  // the page aggregation below both read.
  const analyzed = useMemo(() => {
    const domainCounts = new Map<string, number>();
    const domainMentioned = new Map<string, number>();
    const matching: NormalizedResponse[] = [];
    for (const nr of normalizedResponses) {
      if (!responseMatchesFilters(nr)) continue;
      matching.push(nr);
      for (const d of nr.domains) {
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
        if (nr.company_mentioned) domainMentioned.set(d, (domainMentioned.get(d) || 0) + 1);
      }
    }
    return { domainCounts, domainMentioned, matching, total: matching.length };
  }, [normalizedResponses, responseMatchesFilters]);

  // Previous-period counterpart (counts only — deltas need nothing more).
  const prevAnalyzed = useMemo(() => {
    const domainCounts = new Map<string, number>();
    const pageCounts = new Map<string, number>();
    let total = 0;
    for (const nr of normalizedPrevResponses) {
      if (!responseMatchesFilters(nr)) continue;
      total += 1;
      for (const d of nr.domains) {
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      }
      const seen = new Set<string>();
      for (const p of nr.pages) {
        if (seen.has(p.key)) continue;
        seen.add(p.key);
        pageCounts.set(p.key, (pageCounts.get(p.key) || 0) + 1);
      }
    }
    return { domainCounts, pageCounts, total };
  }, [normalizedPrevResponses, responseMatchesFilters]);

  const hasPrevPeriod = normalizedPrevResponses.length > 0;

  // Ranked domain list with the mentioned/not-mentioned split and
  // previous-period counts for the delta chips.
  const domainList = useMemo(() => {
    return Array.from(analyzed.domainCounts.entries())
      .filter(([domain]) => domain && domain !== 'unknown')
      .map(([domain, count]) => ({
        domain,
        count,
        mentionedCount: analyzed.domainMentioned.get(domain) || 0,
        prevCount: prevAnalyzed.domainCounts.get(domain) || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [analyzed, prevAnalyzed]);

  // ---------------------------------------------------------------------
  // Chart data.
  // Line mode: responses citing each of the top domains, bucketed by week
  // (short periods) or month, contiguous so gaps render as zero. Series keys
  // are s0..s4 — recharts treats dots in dataKey strings ("glassdoor.com")
  // as nested paths, so domains can't be keys directly.
  // Bar mode: horizontal ranking of the top domains within the month the
  // data is currently on (the latest month with responses).
  // ---------------------------------------------------------------------
  const trend = useMemo(() => {
    const series = domainList.slice(0, TREND_SERIES_LIMIT).map(d => d.domain);
    const empty = {
      data: [] as Record<string, any>[],
      series,
      granularity: 'week' as TrendGranularity,
      monthLabel: '',
      monthTotal: 0,
      monthRanking: [] as { name: string; domain: string; count: number }[],
    };
    if (series.length === 0) return empty;

    let minTs = Infinity;
    let maxTs = -Infinity;
    const monthKeys = new Set<string>();
    for (const nr of analyzed.matching) {
      if (nr.testedAt == null) continue;
      if (nr.testedAt < minTs) minTs = nr.testedAt;
      if (nr.testedAt > maxTs) maxTs = nr.testedAt;
      const d = new Date(nr.testedAt);
      monthKeys.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    if (!Number.isFinite(minTs)) return empty;

    const granularity: TrendGranularity = monthKeys.size > 2 ? 'month' : 'week';
    const bucketOf = granularity === 'month' ? startOfMonthTs : startOfWeekTs;

    const bucketStarts: number[] = [];
    let cursor = bucketOf(minTs);
    const last = bucketOf(maxTs);
    while (cursor <= last && bucketStarts.length < 60) {
      bucketStarts.push(cursor);
      const d = new Date(cursor);
      if (granularity === 'month') d.setMonth(d.getMonth() + 1);
      else d.setDate(d.getDate() + 7);
      cursor = d.getTime();
    }

    const multiYear = new Date(minTs).getFullYear() !== new Date(maxTs).getFullYear();
    const rowByBucket = new Map<number, Record<string, any>>();
    const data = bucketStarts.map(ts => {
      const d = new Date(ts);
      const label = granularity === 'month'
        ? d.toLocaleDateString('en-US', multiYear ? { month: 'short', year: '2-digit' } : { month: 'short' })
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const row: Record<string, any> = { ts, label };
      series.forEach((_, i) => { row[`s${i}`] = 0; });
      rowByBucket.set(ts, row);
      return row;
    });

    // Current-month ranking for bar mode: counts scoped to the latest month.
    const currentMonthStart = startOfMonthTs(maxTs);
    const monthLabel = new Date(currentMonthStart).toLocaleDateString('en-US', { month: 'long' });
    const monthCounts = new Map<string, number>();
    let monthTotal = 0;

    const seriesIndex = new Map(series.map((domain, i) => [domain, i]));
    for (const nr of analyzed.matching) {
      if (nr.testedAt == null) continue;
      const row = rowByBucket.get(bucketOf(nr.testedAt));
      if (row) {
        for (const d of nr.domains) {
          const i = seriesIndex.get(d);
          if (i !== undefined) row[`s${i}`] += 1;
        }
      }
      if (startOfMonthTs(nr.testedAt) === currentMonthStart) {
        monthTotal += 1;
        for (const d of nr.domains) {
          if (d === 'unknown') continue;
          monthCounts.set(d, (monthCounts.get(d) || 0) + 1);
        }
      }
    }

    const monthRanking = Array.from(monthCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, BAR_RANK_LIMIT)
      .map(([domain, count]) => ({ name: getSourceDisplayName(domain), domain, count }));

    return { data, series, granularity, monthLabel, monthTotal, monthRanking };
  }, [analyzed, domainList]);

  // ---------------------------------------------------------------------
  // Source type (media type) per domain. Classified from the domain and the
  // company name alone — the responses argument is deliberately omitted
  // because it re-parses every citation. The "competitive" case it would
  // otherwise detect is applied here from the mentioned split we already
  // counted (same >60% rule).
  // ---------------------------------------------------------------------
  const mediaTypeByDomain = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of domainList) {
      const base = categorizeSourceByMediaType(row.domain, [], companyName);
      const notMentioned = row.count - row.mentionedCount;
      map.set(row.domain, base === 'owned' || notMentioned <= row.mentionedCount ? base : 'competitive');
    }
    return map;
  }, [domainList, companyName]);

  // ---------------------------------------------------------------------
  // Focus charts: three ranked slices of the domain list.
  // - Influence opportunities: sources AI leans on that the company is
  //   largely absent from. A domain qualifies when the company is mentioned
  //   in UNDER HALF of the responses citing it (the same majority-absent cut
  //   that classifies a source as "competitive"), and is ranked by its
  //   citing responses WITHOUT a mention — citation volume × absence, so a
  //   heavily-cited source at a 10% mention rate outranks a tiny one at 0%.
  //   Owned domains are excluded (your own site is not something to win).
  // - Employer review sites / social platforms: cited domains grouped into
  //   known platforms, keeping the mentioned split. Clicking a grouped row
  //   opens the platform's most-cited underlying domain.
  // ---------------------------------------------------------------------
  type FocusChartRow = {
    key: string;
    name: string;
    domain: string;        // click target (source modal)
    faviconDomain: string; // logo shown on the row
    count: number;         // total citing responses (drives the bar)
    mentionedCount: number;
    // Number shown on the row when the ranking metric isn't the total —
    // the opportunities card ranks and labels by citations WITHOUT a mention.
    displayCount?: number;
    tooltip: string;
  };

  const focusCharts = useMemo(() => {
    const company = companyName || 'your company';

    const opportunities: FocusChartRow[] = [];
    for (const row of domainList) {
      const gap = row.count - row.mentionedCount;
      if (gap <= row.mentionedCount) continue; // present in half or more of its answers
      if (mediaTypeByDomain.get(row.domain) === 'owned') continue;
      const rate = Math.round((row.mentionedCount / row.count) * 100);
      opportunities.push({
        key: row.domain,
        name: getSourceDisplayName(row.domain),
        domain: row.domain,
        faviconDomain: row.domain,
        count: row.count,
        mentionedCount: row.mentionedCount,
        displayCount: gap,
        tooltip: row.mentionedCount === 0
          ? `${row.count.toLocaleString()} citations — ${company} is never mentioned in these responses`
          : `${gap.toLocaleString()} responses cite this source without mentioning ${company} — ${row.count.toLocaleString()} citations total, only ${rate}% with a mention`,
      });
    }
    const rankedOpportunities = opportunities
      .sort((a, b) => (b.displayCount ?? b.count) - (a.displayCount ?? a.count))
      .slice(0, FOCUS_ROW_LIMIT);

    const groupPlatformRows = (platforms: PlatformGroup[]): FocusChartRow[] => {
      type Group = { platform: PlatformGroup; count: number; mentionedCount: number; domains: string[]; topDomain: string; topCount: number };
      const acc = new Map<string, Group>();
      for (const row of domainList) {
        const platform = platforms.find((p) => p.tokens.some((t) => domainMatchesPlatformToken(row.domain, t)));
        if (!platform) continue;
        let g = acc.get(platform.name);
        if (!g) {
          g = { platform, count: 0, mentionedCount: 0, domains: [], topDomain: row.domain, topCount: 0 };
          acc.set(platform.name, g);
        }
        g.count += row.count;
        g.mentionedCount += row.mentionedCount;
        g.domains.push(row.domain);
        if (row.count > g.topCount) {
          g.topCount = row.count;
          g.topDomain = row.domain;
        }
      }
      return Array.from(acc.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, FOCUS_ROW_LIMIT)
        .map((g) => {
          const rate = g.count > 0 ? Math.round((g.mentionedCount / g.count) * 100) : 0;
          const domainsNote = g.domains.length > 1
            ? ` · includes ${g.domains.slice(0, 3).join(', ')}${g.domains.length > 3 ? '…' : ''}`
            : '';
          return {
            key: g.platform.name,
            name: g.platform.name,
            domain: g.topDomain,
            faviconDomain: g.platform.canonical,
            count: g.count,
            mentionedCount: g.mentionedCount,
            tooltip: `${g.count.toLocaleString()} citations — ${company} mentioned in ${g.mentionedCount.toLocaleString()} (${rate}%)${domainsNote}`,
          };
        });
    };

    return {
      opportunities: rankedOpportunities,
      employerReview: groupPlatformRows(EMPLOYER_REVIEW_PLATFORMS),
      social: groupPlatformRows(SOCIAL_PLATFORMS),
    };
  }, [domainList, mediaTypeByDomain, companyName]);

  // Sentiment bucket of one response, on the same cuts as the pill.
  const sentimentBucket = (ratio: number | null | undefined): SentimentBucket | null => {
    if (typeof ratio !== 'number') return null;
    if (ratio > 0.6) return 'positive';
    if (ratio < 0.4) return 'negative';
    return 'neutral';
  };

  // Cited pages, aggregated under the table's own filters (attributes,
  // question type, models, sentiment) so a filtered row's counts describe
  // only the citations that survived the filter.
  const pageStats = useMemo(() => {
    const attrSet = new Set(filterAttributes);
    const typeSet = new Set(filterQuestionTypes);
    const modelSet = new Set(filterModels);
    const sentSet = new Set(filterSentiments);
    const agg = new Map<string, PageAgg>();

    for (const nr of analyzed.matching) {
      if (attrSet.size > 0 && !(nr.theme && attrSet.has(nr.theme))) continue;
      if (typeSet.size > 0 && !(nr.promptType && typeSet.has(nr.promptType))) continue;
      if (modelSet.size > 0 && !modelSet.has(getLLMDisplayName(nr.model))) continue;
      const ratio = sentimentById.get(nr.id);
      if (sentSet.size > 0) {
        const bucket = sentimentBucket(ratio);
        if (!bucket || !sentSet.has(bucket)) continue;
      }
      for (const p of nr.pages) {
        let row = agg.get(p.key);
        if (!row) {
          row = { key: p.key, url: p.url, title: p.title, domain: p.domain, count: 0, mentionedCount: 0, themeCounts: new Map(), models: new Set(), ratioSum: 0, ratioCount: 0 };
          agg.set(p.key, row);
        }
        row.count += 1;
        if (nr.company_mentioned) row.mentionedCount += 1;
        row.url = preferDisplayUrl(row.url, p.url);
        if (!row.title && p.title) row.title = p.title;
        if (nr.theme) row.themeCounts.set(nr.theme, (row.themeCounts.get(nr.theme) || 0) + 1);
        if (nr.model) row.models.add(nr.model);
        if (typeof ratio === 'number') {
          row.ratioSum += ratio;
          row.ratioCount += 1;
        }
      }
    }
    return agg;
  }, [analyzed, sentimentById, filterAttributes, filterQuestionTypes, filterModels, filterSentiments]);

  // Cited pages, ranked by citing responses, with render-ready derived fields.
  const pagesList = useMemo(() => {
    const sourceTypeSet = new Set(filterSourceTypes);
    const q = pageSearch.trim().toLowerCase();
    return Array.from(pageStats.values())
      .filter(p => p.domain && p.domain !== 'unknown')
      .filter(p => sourceTypeSet.size === 0 || sourceTypeSet.has(mediaTypeByDomain.get(p.domain) || ''))
      .map(p => {
        const themes = Array.from(p.themeCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name);
        // Dedupe models by display name (gpt-4o and gpt-4o-mini are both "OpenAI").
        const models: string[] = [];
        const seenNames = new Set<string>();
        for (const m of p.models) {
          const dn = getLLMDisplayName(m);
          if (!seenNames.has(dn)) {
            seenNames.add(dn);
            models.push(m);
          }
        }
        return {
          key: p.key,
          url: p.url,
          domain: p.domain,
          title: decodeUnicodeEscapes(p.title) || titleFromUrl(p.url, p.domain),
          count: p.count,
          themes,
          models,
          avgRatio: p.ratioCount > 0 ? p.ratioSum / p.ratioCount : null,
          prevCount: prevAnalyzed.pageCounts.get(p.key) || 0,
        };
      })
      .filter(p => !q || p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q) || p.domain.includes(q))
      .sort((a, b) => b.count - a.count);
  }, [pageStats, prevAnalyzed, mediaTypeByDomain, filterSourceTypes, pageSearch]);

  // ---------------------------------------------------------------------
  // Filter option lists, derived from the analyzed responses so a filter
  // never offers a value that can't match anything.
  // ---------------------------------------------------------------------
  const filterOptions = useMemo(() => {
    const attrCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    const sentCounts = new Map<string, number>();
    for (const nr of analyzed.matching) {
      if (nr.theme) attrCounts.set(nr.theme, (attrCounts.get(nr.theme) || 0) + 1);
      if (nr.promptType) typeCounts.set(nr.promptType, (typeCounts.get(nr.promptType) || 0) + 1);
      if (nr.model) {
        const dn = getLLMDisplayName(nr.model);
        modelCounts.set(dn, (modelCounts.get(dn) || 0) + 1);
      }
      const bucket = sentimentBucket(sentimentById.get(nr.id));
      if (bucket) sentCounts.set(bucket, (sentCounts.get(bucket) || 0) + 1);
    }
    const sourceTypeCounts = new Map<string, number>();
    for (const row of domainList) {
      const t = mediaTypeByDomain.get(row.domain);
      if (t) sourceTypeCounts.set(t, (sourceTypeCounts.get(t) || 0) + 1);
    }
    const byCountDesc = (a: [string, number], b: [string, number]) => b[1] - a[1];
    return {
      attributes: Array.from(attrCounts.entries()).sort(byCountDesc)
        .map(([value, count]) => ({
          value,
          label: value,
          count,
          adornment: (() => {
            const Icon = getAttributeIconByName(value);
            return <Icon className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />;
          })(),
        })),
      questionTypes: Array.from(typeCounts.entries()).sort(byCountDesc)
        .map(([value, count]) => ({ value, label: value.replace(/_/g, ' '), count })),
      sourceTypes: SOURCE_TYPE_ORDER.filter(t => sourceTypeCounts.has(t))
        .map(value => ({ value, label: value, count: sourceTypeCounts.get(value) })),
      models: Array.from(modelCounts.entries()).sort(byCountDesc)
        .map(([value, count]) => ({
          value,
          label: value,
          count,
          adornment: <LLMLogo modelName={value} size="sm" showFallback={false} />,
        })),
      sentiments: SENTIMENT_ORDER.filter(s => sentCounts.has(s))
        .map(value => ({ value, label: value, count: sentCounts.get(value) })),
    };
  }, [analyzed, sentimentById, domainList, mediaTypeByDomain]);

  const activeFilterCount =
    filterAttributes.length + filterQuestionTypes.length + filterSourceTypes.length +
    filterModels.length + filterSentiments.length;

  const clearAllFilters = () => {
    setFilterAttributes([]);
    setFilterQuestionTypes([]);
    setFilterSourceTypes([]);
    setFilterModels([]);
    setFilterSentiments([]);
  };

  // Coverage share of a domain/page: % of analyzed responses citing it.
  const shareOf = (count: number, total: number) =>
    total > 0 ? Math.min(100, (count / total) * 100) : 0;

  // Delta chip: percentage-point change of the coverage share vs the previous
  // period. Only shown for sources that existed in the previous period.
  const renderShareDelta = (count: number, prevCount: number) => {
    if (!hasPrevPeriod || prevCount <= 0) return null;
    const cur = shareOf(count, analyzed.total);
    const prev = shareOf(prevCount, prevAnalyzed.total);
    const delta = Math.round(cur - prev);
    if (delta === 0) return <span className="text-xs text-gray-400">-</span>;
    return (
      <span className={`text-xs font-semibold flex items-center gap-0.5 ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
        {delta > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
        <span className="whitespace-nowrap">{Math.abs(delta)}%</span>
      </span>
    );
  };

  // Relative change in a page's citation count vs the previous period, as a
  // percentage — "1,117 more citations" says nothing without the base, "+92%"
  // does. Pages with no prior citations are flagged "New" beside the title
  // instead (a percentage off a zero base is undefined).
  const renderCountDelta = (count: number, prevCount: number) => {
    if (!hasPrevPeriod || prevCount <= 0) return null;
    const pct = Math.round(((count - prevCount) / prevCount) * 100);
    if (pct === 0) return <span className="text-xs text-gray-400">-</span>;
    return (
      <span className={`text-xs font-semibold flex items-center gap-0.5 ${pct > 0 ? 'text-green-600' : 'text-red-600'}`}>
        {pct > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
        <span className="whitespace-nowrap">{Math.abs(pct)}%</span>
      </span>
    );
  };

  const sentimentPill = (ratio: number | null) => {
    if (ratio === null) return <span className="text-xs text-gray-400">—</span>;
    let cls = 'bg-gray-100 text-gray-600';
    let label = 'Neutral';
    if (ratio > 0.6) { cls = 'bg-green-100 text-green-700'; label = 'Positive'; }
    else if (ratio < 0.4) { cls = 'bg-red-100 text-red-700'; label = 'Negative'; }
    return <Badge className={`${cls} border-0 text-xs font-medium pointer-events-none`}>{label}</Badge>;
  };

  const hasAnyData = domainList.length > 0;
  const domainsToRender = showAllDomains ? domainList : domainList.slice(0, INITIAL_DOMAIN_LIMIT);
  const pagesToRender = pagesList.slice(0, visiblePageRows);
  const chartSeriesSet = useMemo(() => new Map(trend.series.map((d, i) => [d, CHART_COLORS[i]])), [trend.series]);

  // Shared crosshair tooltip for the line chart: bucket label, then series
  // rows sorted by value.
  const TrendTooltipContent = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const rows = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0));
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md min-w-[180px]">
        <p className="text-xs font-semibold text-gray-900 mb-1.5">{label}</p>
        {rows.map((p) => (
          <div key={p.name} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
            <Favicon domain={p.name} size="sm" />
            <span className="text-xs text-gray-600 truncate max-w-[150px]">{p.name}</span>
            <span className="ml-auto text-xs font-semibold text-gray-900 tabular-nums pl-3">{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  // Per-bar tooltip for the current-month ranking.
  const RankTooltipContent = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
        <div className="flex items-center gap-1.5">
          <Favicon domain={row.domain} size="sm" />
          <p className="text-xs font-semibold text-gray-900">{row.name}</p>
        </div>
        <p className="text-xs text-gray-600 mt-0.5">
          {row.count.toLocaleString()} citations
          {trend.monthTotal > 0 && <> · {shareOf(row.count, trend.monthTotal).toFixed(1)}% of responses</>}
        </p>
      </div>
    );
  };

  // Y-axis tick for the ranking chart: the domain's logo beside its name, so a
  // domain is never named without its mark. SVG <image> (not the Favicon
  // component) because ticks render inside the chart surface.
  const RANK_AXIS_WIDTH = 168;
  const RankAxisTick = ({ x, y, payload }: any) => {
    const domain: string = payload?.value || '';
    // `x` is the axis line; the label block starts at the chart's left edge.
    // Clamped at 0 so the logo never renders outside the SVG viewport.
    const left = Math.max(0, x - RANK_AXIS_WIDTH + 8);
    const label = domain.length > 18 ? `${domain.slice(0, 17)}…` : domain;
    return (
      <g
        transform={`translate(${left}, ${y})`}
        style={{ cursor: 'pointer' }}
        onClick={() => openDomainModal(domain)}
      >
        {/* Invisible hit area so the whole label row is clickable, not just the glyphs. */}
        <rect x={-4} y={-11} width={RANK_AXIS_WIDTH} height={22} fill="transparent" />
        {/* Letter chip sits under the logo: SVG <image> has no error fallback,
            so a logo that fails to load (e.g. no logo.dev token configured)
            reveals this instead of a broken-image glyph. */}
        <rect x={0} y={-7} width={14} height={14} rx={3} fill="#F3F4F6" />
        <text x={7} y={0} dy="0.32em" textAnchor="middle" fontSize={9} fontWeight={600} fill="#9CA3AF">
          {domain.charAt(0).toUpperCase()}
        </text>
        <image href={getFavicon(domain, 32)} x={0} y={-7} width={14} height={14} preserveAspectRatio="xMidYMid meet" />
        <text x={20} y={0} dy="0.32em" textAnchor="start" fontSize={11} fill="#374151">{label}</text>
      </g>
    );
  };

  const axisTickStyle = { fontSize: 11, fill: '#9CA3AF' } as const;

  const renderTrendChart = () => {
    if (trendChartType === 'bar') {
      if (trend.monthRanking.length === 0) {
        return (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            No citation data for this month.
          </div>
        );
      }
      // Nominal ranking: one series, so every bar wears the brand hue — the
      // title carries identity, values ride the bar ends.
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend.monthRanking} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={RANK_AXIS_WIDTH}
              tick={<RankAxisTick />}
              tickLine={false}
              axisLine={false}
            />
            <RechartsTooltip content={<RankTooltipContent />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar
              dataKey="count"
              name="Citations"
              fill={MENTIONED_COLOR}
              // Fully rounded ends (half the bar thickness), matching the
              // pill-shaped bars used elsewhere in the dashboard.
              radius={[RANK_BAR_SIZE / 2, RANK_BAR_SIZE / 2, RANK_BAR_SIZE / 2, RANK_BAR_SIZE / 2]}
              maxBarSize={RANK_BAR_SIZE}
              cursor="pointer"
              onClick={(data: any) => openDomainModal(data?.domain || data?.payload?.domain)}
              // Responses stream in after first paint, so the bars re-render
              // mid-animation and recharts' onAnimationEnd never fires — which
              // permanently suppresses the LabelList values. No entry animation
              // means the values are always drawn.
              isAnimationActive={false}
            >
              <LabelList
                dataKey="count"
                position="right"
                formatter={(v: number) => v.toLocaleString()}
                style={{ fontSize: 11, fill: '#6B7280' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (trend.data.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-gray-400">
          No trend data for this period.
        </div>
      );
    }
    const showDots = trend.data.length <= 10;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#F3F4F6" />
          <XAxis dataKey="label" tick={axisTickStyle} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} width={34} tick={axisTickStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip content={<TrendTooltipContent />} cursor={{ stroke: '#E5E7EB' }} />
          {trend.series.map((domain, i) => (
            <Line
              key={domain}
              type="monotone"
              dataKey={`s${i}`}
              name={domain}
              stroke={CHART_COLORS[i]}
              strokeWidth={2}
              dot={showDots ? { r: 3.5, fill: CHART_COLORS[i], stroke: '#ffffff', strokeWidth: 1.5 } : false}
              activeDot={{ r: 4, fill: CHART_COLORS[i], stroke: '#ffffff', strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  };

  const renderDomainRow = (row: { domain: string; count: number; mentionedCount: number; prevCount: number }, idx: number) => {
    const displayName = getSourceDisplayName(row.domain);
    const share = shareOf(row.count, analyzed.total);
    const seriesColor = chartSeriesSet.get(row.domain);
    const mentionRate = row.count > 0 ? (row.mentionedCount / row.count) * 100 : 0;
    return (
      <button
        key={row.domain}
        onClick={() => handleSourceClick({ domain: row.domain, count: row.count })}
        className="w-full text-left px-2 sm:px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        title={`${row.count.toLocaleString()} citations — ${companyName || 'company'} mentioned in ${row.mentionedCount.toLocaleString()} (${Math.round(mentionRate)}%)`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-5 text-right text-xs font-medium text-gray-400 tabular-nums flex-shrink-0">{idx + 1}</span>
          <Favicon domain={row.domain} />
          <span className="text-sm font-medium text-gray-900 truncate" title={displayName}>{displayName}</span>
          {seriesColor && (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: seriesColor }} aria-hidden />
          )}
          <span className="ml-auto flex-shrink-0 text-sm font-semibold text-gray-900 tabular-nums">
            {share.toFixed(1)}%
          </span>
        </div>
        {/* Mentioned/not-mentioned split for this domain's citations, with the
            period-over-period change of its coverage share beside it. The left
            inset (rank width + gap) lines the bar up with the domain logo. */}
        <div className="mt-1.5 ml-[30px] flex items-center gap-2">
          <div className="flex-1 h-1.5 flex gap-[2px] rounded-full overflow-hidden">
            {mentionRate > 0 && (
              <div className="h-full rounded-full" style={{ width: `${mentionRate}%`, backgroundColor: MENTIONED_COLOR }} />
            )}
            {mentionRate < 100 && (
              <div className="h-full rounded-full" style={{ width: `${100 - mentionRate}%`, backgroundColor: NOT_MENTIONED_COLOR }} />
            )}
          </div>
          <span className="w-[45px] flex justify-end flex-shrink-0">{renderShareDelta(row.count, row.prevCount)}</span>
        </div>
      </button>
    );
  };

  const loadingSkeleton = (rows: number) => (
    <div className="space-y-3 py-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-md bg-gray-100 animate-pulse" />
      ))}
    </div>
  );

  // One row of a focus chart: platform/domain identity on top, a magnitude bar
  // below it. Bars share the card's left baseline and are scaled to the card's
  // largest total, so each card reads as its own small ranking. The bar reuses
  // the page-wide split encoding — teal for citations in responses that
  // mention the company, gray where it's absent. The row's number is the
  // ranking metric (total citations, or the without-a-mention count on the
  // opportunities card).
  const renderFocusRow = (row: {
    key: string; name: string; domain: string; faviconDomain: string;
    count: number; mentionedCount: number; displayCount?: number; tooltip: string;
  }, maxCount: number) => {
    const barPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
    const mentionedPct = row.count > 0 ? (barPct * row.mentionedCount) / row.count : 0;
    const notMentionedPct = barPct - mentionedPct;
    return (
      <button
        key={row.key}
        onClick={() => handleSourceClick({ domain: row.domain, count: analyzed.domainCounts.get(row.domain) || row.count })}
        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
        title={row.tooltip}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Favicon domain={row.faviconDomain} />
          <span className="text-sm font-medium text-gray-900 truncate" title={row.name}>{row.name}</span>
          <span className="ml-auto flex-shrink-0 pl-2 text-sm font-semibold text-gray-900 tabular-nums">
            {(row.displayCount ?? row.count).toLocaleString()}
          </span>
        </div>
        <div className="mt-1 flex gap-[2px]" aria-hidden>
          {mentionedPct > 0 && (
            <div className="h-1.5 rounded-full" style={{ width: `${mentionedPct}%`, backgroundColor: MENTIONED_COLOR }} />
          )}
          {notMentionedPct > 0 && (
            <div className="h-1.5 rounded-full" style={{ width: `${notMentionedPct}%`, backgroundColor: NOT_MENTIONED_COLOR }} />
          )}
        </div>
      </button>
    );
  };

  const renderFocusCard = (opts: {
    title: string;
    subtitle: string;
    rows: { key: string; name: string; domain: string; faviconDomain: string; count: number; mentionedCount: number; displayCount?: number; tooltip: string }[];
    emptyText: string;
  }) => {
    // Bars are sized by TOTAL citations; on the opportunities card the rows
    // are ordered by the gap instead, so the max isn't necessarily row 0.
    const maxCount = opts.rows.reduce((m, r) => Math.max(m, r.count), 0);
    return (
      <Card key={opts.title} className="shadow-sm border border-gray-200 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-bold text-gray-800">{opts.title}</CardTitle>
            {opts.rows.length > 0 && (
              <div className="flex items-center gap-2.5 text-[11px] text-gray-400 flex-shrink-0 pt-0.5">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: MENTIONED_COLOR }} />
                  Mentioned
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: NOT_MENTIONED_COLOR }} />
                  Not mentioned
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500">{opts.subtitle}</p>
        </CardHeader>
        <CardContent className="flex-1 pt-0 px-2 sm:px-3 pb-3">
          {responsesLoading && !hasAnyData ? (
            <div className="px-2">{loadingSkeleton(4)}</div>
          ) : opts.rows.length === 0 ? (
            <div className="h-full min-h-[120px] flex items-center justify-center px-4 text-center text-sm text-gray-400">
              {opts.emptyText}
            </div>
          ) : (
            opts.rows.map((row) => renderFocusRow(row, maxCount))
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Main Section Header */}
      <div className="space-y-2" data-tour="sources-heading">
        <h2 className="text-2xl font-bold text-gray-900">Sources</h2>
        <p className="text-gray-600">
          Discover where {companyName} is mentioned across the web and analyze source performance over time.
        </p>
      </div>

      {/* Job function filter */}
      {getUniqueJobFunctions.length > 0 && (
        <div className="sticky top-0 z-10 bg-white pb-2">
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

      {!hasAnyData && !responsesLoading ? (
        <Card className="shadow-sm border border-gray-200">
          <CardContent className="p-6">
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-sm">No citations found yet.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Row 1: trend chart + ranked domain list */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
            <Card data-tour="sources-chart" className="shadow-sm border border-gray-200 lg:col-span-3 flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-bold text-gray-800">Top cited domains</CardTitle>
                  </div>
                  {/* Ranking first — it's the default view. */}
                  <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-100 flex-shrink-0">
                    <button
                      onClick={() => setTrendChartType('bar')}
                      title="This month's ranking"
                      aria-label="This month's ranking"
                      className={`px-2 py-1 rounded-md transition-all ${
                        trendChartType === 'bar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <BarChartHorizontal className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setTrendChartType('line')}
                      title="Trend over time"
                      aria-label="Trend over time"
                      className={`px-2 py-1 rounded-md transition-all ${
                        trendChartType === 'line' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <ChartLine className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col pt-2">
                {responsesLoading && !hasAnyData ? (
                  <div className="flex-1 min-h-[280px] rounded-md bg-gray-100 animate-pulse" aria-busy="true" />
                ) : (
                  <>
                    {/* Fills the card so the chart matches the height of the
                        domain list beside it instead of leaving dead space. */}
                    <div className="flex-1 min-h-[280px]">
                      {renderTrendChart()}
                    </div>
                    {/* Legend (line mode): identity via favicon + name, never color alone */}
                    {trendChartType === 'line' && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 px-1">
                        {trend.series.map((domain, i) => (
                          <button
                            key={domain}
                            onClick={() => handleSourceClick({ domain, count: analyzed.domainCounts.get(domain) || 0 })}
                            className="flex items-center gap-1.5 group min-w-0"
                            title={`Open ${domain}`}
                          >
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_COLORS[i] }} />
                            <Favicon domain={domain} size="sm" />
                            <span className="text-xs text-gray-600 group-hover:text-gray-900 truncate max-w-[150px]">
                              {getSourceDisplayName(domain)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-tour="sources-domain-list" className="shadow-sm border border-gray-200 lg:col-span-2 flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <CardTitle className="text-base font-bold text-gray-800">Cited domains</CardTitle>
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-xs">
                      {domainList.length.toLocaleString()}
                    </Badge>
                  </div>
                  {/* Key for the per-row split bar + the % definition */}
                  <div className="flex items-center gap-2.5 text-[11px] text-gray-400 flex-shrink-0">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: MENTIONED_COLOR }} />
                      Mentioned
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: NOT_MENTIONED_COLOR }} />
                      Not mentioned
                    </span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help"><Info className="w-3.5 h-3.5" /></span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[280px]">
                          <p className="text-xs">
                            The percentage is the share of analyzed AI responses that cite
                            this source (responses cite several sources, so these don't add
                            up to 100%). The bar splits each source's citations into
                            responses that mention {companyName || 'your company'} and
                            responses where it's absent.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 pt-0 px-2 sm:px-3 pb-3">
                {responsesLoading && !hasAnyData ? (
                  <div className="px-2">{loadingSkeleton(8)}</div>
                ) : (
                  <div className="h-full max-h-[400px] overflow-y-auto pr-1">
                    {domainsToRender.map((row, idx) => renderDomainRow(row, idx))}
                    {!showAllDomains && domainList.length > INITIAL_DOMAIN_LIMIT && (
                      <div className="pt-3 pb-2 text-center">
                        <Button variant="outline" size="sm" onClick={() => setShowAllDomains(true)}>
                          Show all {domainList.length.toLocaleString()} domains
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 2: focus charts — the influence gap and the two platform
              families clients act on. Same data as the domain list above,
              sliced three ways. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch" data-tour="sources-focus">
            {renderFocusCard({
              title: 'Top influence opportunities',
              subtitle: `Sources AI leans on where ${companyName || 'your company'} is missing from most answers — ranked by citations without a mention.`,
              rows: focusCharts.opportunities,
              emptyText: `No influence gaps — ${companyName || 'your company'} appears in most answers across every cited source.`,
            })}
            {renderFocusCard({
              title: 'Top employer review sites',
              subtitle: 'The review platforms AI leans on when describing employers.',
              rows: focusCharts.employerReview,
              emptyText: 'No employer review sites cited in this period.',
            })}
            {renderFocusCard({
              title: 'Top social media platforms',
              subtitle: 'The social platforms AI pulls into its answers.',
              rows: focusCharts.social,
              emptyText: 'No social media platforms cited in this period.',
            })}
          </div>

          {/* Row 3: top cited pages */}
          <Card data-tour="sources-pages" className="shadow-sm border border-gray-200">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold text-gray-800">Top cited pages</CardTitle>
                <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-0 text-xs">
                  {pagesList.length.toLocaleString()}
                </Badge>
              </div>
              <p className="text-xs text-gray-500">
                The specific pages behind the citations — with the attributes, models and sentiment they show up in.
                Click a page to open its source.
              </p>
              {/* Toolbar: search + filters. A filter with nothing selected is
                  inactive, so the default view shows every page. */}
              <div className="flex items-center gap-2 flex-wrap pt-3" data-tour="sources-pages-toolbar">
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={pageSearch}
                    onChange={(e) => setPageSearch(e.target.value)}
                    placeholder="Search URL or title…"
                    aria-label="Search cited pages"
                    className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs shadow-sm outline-none placeholder:text-gray-400 focus:border-gray-300"
                  />
                </div>
                <FilterDropdown
                  label="Attributes" icon={Tags} searchable
                  options={filterOptions.attributes}
                  selected={filterAttributes} onChange={setFilterAttributes}
                />
                <FilterDropdown
                  label="Question Type" icon={HelpCircle}
                  options={filterOptions.questionTypes}
                  selected={filterQuestionTypes} onChange={setFilterQuestionTypes}
                />
                <FilterDropdown
                  label="Source Types" icon={Globe}
                  options={filterOptions.sourceTypes}
                  selected={filterSourceTypes} onChange={setFilterSourceTypes}
                />
                <FilterDropdown
                  label="Models" icon={Bot}
                  options={filterOptions.models}
                  selected={filterModels} onChange={setFilterModels}
                />
                <FilterDropdown
                  label="Sentiment" icon={SmilePlus}
                  options={filterOptions.sentiments}
                  selected={filterSentiments} onChange={setFilterSentiments}
                />
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800 px-1"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0 sm:px-2 pb-3">
              {responsesLoading && !hasAnyData ? (
                <div className="px-6">{loadingSkeleton(6)}</div>
              ) : pagesList.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[48%] min-w-[260px] text-xs">Page</TableHead>
                        <TableHead className="hidden md:table-cell text-xs">Attributes</TableHead>
                        <TableHead className="hidden sm:table-cell text-xs">Models</TableHead>
                        <TableHead className="hidden sm:table-cell text-xs">Sentiment</TableHead>
                        <TableHead className="text-right text-xs">Citations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagesToRender.map((page) => {
                        const isNew = hasPrevPeriod && page.prevCount === 0 && page.count >= 2;
                        return (
                          <TableRow
                            key={page.key}
                            onClick={() => handleSourceClick({ domain: page.domain, count: analyzed.domainCounts.get(page.domain) || page.count })}
                            className="cursor-pointer"
                          >
                            <TableCell className="py-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <Favicon domain={page.domain} className="mt-0.5 flex-shrink-0" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-sm font-medium text-gray-900 truncate max-w-[460px]" title={page.title}>
                                      {page.title}
                                    </span>
                                    {isNew && (
                                      <Badge className="bg-green-100 text-green-700 border-0 text-[10px] px-1.5 py-0 pointer-events-none flex-shrink-0">
                                        New
                                      </Badge>
                                    )}
                                  </div>
                                  <a
                                    href={page.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="group/link inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0DBCBA] min-w-0 max-w-full"
                                    title={page.url}
                                  >
                                    <span className="truncate max-w-[420px]">{formatDisplayUrl(page.url)}</span>
                                    <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                  </a>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell py-3">
                              {page.themes.length > 0 ? (
                                <TooltipProvider>
                                  {/* Overlapping stack: the most-cited attribute
                                      sits on top, the rest tuck behind it to
                                      the right. */}
                                  <div className="flex items-center w-fit">
                                    <div className="flex items-center">
                                      {page.themes.slice(0, 5).map((theme, i) => {
                                        const Icon = getAttributeIconByName(theme);
                                        return (
                                          <Tooltip key={theme}>
                                            <TooltipTrigger asChild>
                                              <span
                                                className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 ring-2 ring-white cursor-help transition-colors hover:bg-gray-200"
                                                style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
                                              >
                                                <Icon className="w-3.5 h-3.5 text-gray-600" />
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent><p className="text-xs">{theme}</p></TooltipContent>
                                          </Tooltip>
                                        );
                                      })}
                                    </div>
                                    {page.themes.length > 5 && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="text-xs text-gray-400 cursor-help pl-3">+{page.themes.length - 5}</span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-[260px]">
                                          <p className="text-xs">{page.themes.slice(5, 15).join(', ')}{page.themes.length > 15 ? '…' : ''}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </TooltipProvider>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell py-3">
                              {page.models.length > 0 ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      {/* Same overlapping stack as the attributes column. */}
                                      <div className="flex items-center w-fit cursor-default">
                                        {page.models.slice(0, 4).map((model, i) => (
                                          <span
                                            key={model}
                                            className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white ring-2 ring-white"
                                            style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
                                          >
                                            <LLMLogo modelName={model} size="sm" />
                                          </span>
                                        ))}
                                        {page.models.length > 4 && (
                                          <span className="pl-1.5 text-xs text-gray-400">+{page.models.length - 4}</span>
                                        )}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">{page.models.map((m) => getLLMDisplayName(m)).join(', ')}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell py-3">
                              {sentimentPill(page.avgRatio)}
                            </TableCell>
                            <TableCell className="text-right py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-sm font-semibold text-gray-900 tabular-nums">{page.count.toLocaleString()}</span>
                                <span className="w-[52px] flex justify-end">{renderCountDelta(page.count, page.prevCount)}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {pagesList.length > visiblePageRows && (
                    <div className="pt-3 pb-1 text-center">
                      <Button variant="outline" size="sm" onClick={() => setVisiblePageRows(v => v + PAGE_ROWS_STEP)}>
                        Show more ({(pagesList.length - visiblePageRows).toLocaleString()} remaining)
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  {activeFilterCount > 0 || pageSearch.trim() ? (
                    <>
                      <p className="text-sm">No pages match these filters.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => { clearAllFilters(); setPageSearch(''); }}
                      >
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm">No cited pages found yet.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Source Details Modal */}
      {selectedSource && (
        <SourceDetailsModal
          isOpen={isSourceModalOpen}
          onClose={handleCloseSourceModal}
          source={selectedSource}
          responses={getResponsesForSource(selectedSource.domain)}
          previousResponses={getPrevResponsesForSource(selectedSource.domain)}
          companyName={companyName}
          searchResults={filteredSearchResults}
          companyId={currentCompanyId}
          selectedThemeFilter="all"
          companyMentionedFilter="all"
          responseTexts={responseTexts}
          fetchResponseTexts={fetchResponseTexts}
        />
      )}
    </div>
  );
});
SourcesTab.displayName = 'SourcesTab';
