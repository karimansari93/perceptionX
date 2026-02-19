import { useState, useEffect, useMemo, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount, LLMMentionRanking } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target, HelpCircle, X, TrendingDown, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { usePersistedState } from "@/hooks/usePersistedState";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LLMLogo from "@/components/LLMLogo";
import { KeyTakeaways } from "./KeyTakeaways";
import { SourcesSummaryCard } from "./SourcesSummaryCard";
import { CompetitorsSummaryCard } from "./CompetitorsSummaryCard";
import { AttributesSummaryCard } from "./AttributesSummaryCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Favicon } from "@/components/ui/favicon";
import { extractSourceUrl } from "@/utils/citationUtils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, BarChart, Bar, ResponsiveContainer, Cell } from "recharts"
import { ChartConfig } from "@/components/ui/chart"

interface AITheme {
  id: string;
  response_id: string;
  theme_name: string;
  theme_description: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  talentx_attribute_id: string;
  talentx_attribute_name: string;
  confidence_score: number;
  keywords: string[];
  context_snippets: string[];
  created_at: string;
}

interface OverviewTabProps {
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  topCompetitors: { company: string; count: number }[];
  responses: any[]; // Add responses prop
  competitorLoading?: boolean; // Add competitor loading prop
  companyName: string; // <-- Add this
  llmMentionRankings: LLMMentionRanking[]; // Add this
  talentXProData?: any[]; // Add TalentX Pro data
  isPro?: boolean; // Add Pro subscription status
  searchResults?: any[]; // Add search results
  aiThemes?: AITheme[]; // Add AI themes as prop
  recencyData?: any[]; // Add recency data for relevance calculation
  recencyDataLoading?: boolean; // Loading state for recency data
  aiThemesLoading?: boolean; // Loading state for AI themes
  metricsCalculating?: boolean; // Whether metrics are still being calculated (for UX - show all together)
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
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
  metrics, 
  topCitations, 
  topCompetitors,
  responses,
  competitorLoading = false,
  companyName,
  llmMentionRankings,
  talentXProData = [],
  isPro = false,
  searchResults = [],
  aiThemes = [],
  recencyData = [],
  recencyDataLoading = false,
  aiThemesLoading = false,
  metricsCalculating = false,
  responseTexts = {},
  fetchResponseTexts
}: OverviewTabProps) => {
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
  const [isScoreBreakdownModalOpen, setIsScoreBreakdownModalOpen] = usePersistedState<boolean>('overviewTab.isScoreBreakdownModalOpen', false);

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
    
    // Calculate sentiment for each response ID once
    themesByResponseId.forEach((responseThemes, responseId) => {
      const totalThemes = responseThemes.length;
      
      if (totalThemes === 0) {
        cache.set(responseId, { sentiment_score: 0, sentiment_label: 'neutral' });
        return;
      }
      
      const positiveThemes = responseThemes.filter(theme => theme.sentiment === 'positive').length;
      
      // Sentiment score: positive themes / total themes (0-1 scale)
      const sentimentRatio = positiveThemes / totalThemes;
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
  const breakdowns = [
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
  ];

  const getFavicon = (domain: string): string => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=16`;
  };

  // Helper to group responses by time period
  const groupResponsesByTimePeriod = useMemo(() => {
    if (responses.length === 0) return { current: [], previous: [] };

    // Sort responses by tested_at descending
    const sortedResponses = [...responses].sort((a, b) => 
      new Date(b.tested_at).getTime() - new Date(a.tested_at).getTime()
    );

    // Find the most recent date
    const latestDate = new Date(sortedResponses[0].tested_at);
    
    // Group responses into current (latest date) and previous (all other dates)
    const current = sortedResponses.filter(r => {
      const responseDate = new Date(r.tested_at);
      return responseDate.toDateString() === latestDate.toDateString();
    });
    
    const previous = sortedResponses.filter(r => {
      const responseDate = new Date(r.tested_at);
      return responseDate.toDateString() !== latestDate.toDateString();
    });

    // If we only have responses from one date, treat them all as current
    if (previous.length === 0) {
      return { current: sortedResponses, previous: [] };
    }

    return { current, previous };
  }, [responses]);

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
    const previousUniqueDays = new Set(previous.map(r => new Date(r.tested_at).toDateString()));
    const numPreviousDays = Math.max(1, previousUniqueDays.size);

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
    const previousUniqueDays = new Set(previous.map(r => new Date(r.tested_at).toDateString()));
    const numPreviousDays = Math.max(1, previousUniqueDays.size);

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
  const normalizedTopCompetitors = Array.from(normalizedCompetitorsMap.values()).sort((a, b) => b.count - a.count);

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

    // Group themes by TalentX attribute
    const attributeGroups: { [key: string]: { positive: AITheme[], negative: AITheme[], neutral: AITheme[] } } = {};
    
    aiThemes.forEach(theme => {
      if (!attributeGroups[theme.talentx_attribute_id]) {
        attributeGroups[theme.talentx_attribute_id] = { positive: [], negative: [], neutral: [] };
      }
      attributeGroups[theme.talentx_attribute_id][theme.sentiment].push(theme);
    });

    const positiveAttributes: { attribute: string; name: string; themes: AITheme[]; avgScore: number }[] = [];
    const negativeAttributes: { attribute: string; name: string; themes: AITheme[]; avgScore: number }[] = [];

    // Analyze each attribute
    Object.entries(attributeGroups).forEach(([attributeId, themes]) => {
      const totalThemes = themes.positive.length + themes.negative.length + themes.neutral.length;
      
      // Consider an attribute "overwhelmingly" positive/negative if:
      // 1. It has at least 2 themes
      // 2. At least 70% of themes are in one sentiment direction
      // 3. The average sentiment score is significant (>0.5 or <-0.5)
      
      if (totalThemes >= 2) {
        const positiveRatio = themes.positive.length / totalThemes;
        const negativeRatio = themes.negative.length / totalThemes;
        const avgSentimentScore = aiThemes
          .filter(t => t.talentx_attribute_id === attributeId)
          .reduce((sum, t) => sum + t.sentiment_score, 0) / totalThemes;

        if (positiveRatio >= 0.7 && avgSentimentScore > 0.5) {
          positiveAttributes.push({
            attribute: attributeId,
            name: themes.positive[0]?.talentx_attribute_name || attributeId,
            themes: themes.positive,
            avgScore: avgSentimentScore
          });
        } else if (negativeRatio >= 0.7 && avgSentimentScore < -0.5) {
          negativeAttributes.push({
            attribute: attributeId,
            name: themes.negative[0]?.talentx_attribute_name || attributeId,
            themes: themes.negative,
            avgScore: avgSentimentScore
          });
        }
      }
    });

    // Sort by average score and take top 2
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

  const visibilityTrendData = useMemo(() => {
    if (!responses || responses.length === 0) {
      return [];
    }

    const dataByDate: Record<string, { totalScore: number; count: number }> = {};
    
    responses.forEach(response => {
      if (typeof response.company_mentioned === 'boolean') {
        const date = new Date(response.tested_at).toISOString().split('T')[0];
        if (!dataByDate[date]) {
          dataByDate[date] = { totalScore: 0, count: 0 };
        }
        dataByDate[date].totalScore += response.company_mentioned ? 1 : 0;
        dataByDate[date].count += 1;
      }
    });

    const trendData = Object.entries(dataByDate).map(([date, { totalScore, count }]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      "Visibility": Math.round((totalScore / count) * 100),
    }));

    return trendData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [responses]);

  const aiThemeLookup = useMemo(() => {
    const map = new Map<string, any>();
    (aiThemes || []).forEach(theme => {
      if (!map.has(theme.response_id)) {
        map.set(theme.response_id, theme);
      }
    });
    return map;
  }, [aiThemes]);

  const sentimentTrendData = useMemo(() => {
    if (!responses || responses.length === 0) {
      return [];
    }
  
    const dataByDate: Record<string, { totalScore: number; count: number }> = {};
    
    responses.forEach(response => {
      const theme = aiThemeLookup.get(response.id);
      const sentimentScore = theme?.avg_sentiment_score;
      if (typeof sentimentScore === 'number') {
        const date = new Date(response.tested_at).toISOString().split('T')[0];
        if (!dataByDate[date]) {
          dataByDate[date] = { totalScore: 0, count: 0 };
        }
        dataByDate[date].totalScore += sentimentScore;
        dataByDate[date].count += 1;
      }
    });
  
    const trendData = Object.entries(dataByDate).map(([date, { totalScore, count }]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      "Sentiment": Math.round((totalScore / count) * 100),
    }));
  
    return trendData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [responses, aiThemeLookup]);

  const chartConfig = {
    Visibility: {
      label: "Visibility",
      color: "hsl(var(--chart-1))",
    },
    Sentiment: {
      label: "Sentiment",
      color: "hsl(var(--chart-2))",
    },
  } satisfies ChartConfig

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
    
    // Step 1: Get all unique tested_at dates (collection periods)
    const uniqueDates = new Set<string>();
    responses.forEach(r => {
      const date = new Date(r.tested_at).toISOString().split('T')[0];
      uniqueDates.add(date);
    });
    
    
    // Step 2: For each collection period, get the latest response per prompt+model combination
    const collectionPeriods = Array.from(uniqueDates).map(date => {
      // Get all responses from this date
      const dateResponses = responses.filter(r => {
        const responseDate = new Date(r.tested_at).toISOString().split('T')[0];
        return responseDate === date;
      });
      
      
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
               promptType === 'competitive' ||
               promptType === 'talentx_experience' ||
               promptType === 'talentx_competitive';
      });
      
      // Sentiment: positive themes / total themes from ai_themes for this period
      let avgSentiment = 0;
      if (aiThemes.length > 0) {
        const periodResponseIds = new Set(periodResponses.map(r => r.id));
        const periodThemes = aiThemes.filter(theme => periodResponseIds.has(theme.response_id));
        const totalThemes = periodThemes.length;
        const positiveThemes = periodThemes.filter(theme => theme.sentiment === 'positive').length;
        
        avgSentiment = totalThemes > 0 ? positiveThemes / totalThemes : 0;
      }
      // Convert ratio (0-1) to percentage (0-100)
      const normalizedSentiment = Math.max(0, Math.min(100, avgSentiment * 100));
      
      // Calculate visibility (percentage of responses where company was mentioned)
      const mentionedCount = periodResponses.filter(r => r.company_mentioned === true).length;
      const avgVisibility = periodResponses.length > 0 
        ? (mentionedCount / periodResponses.length) * 100 
        : 0;
      
      // Calculate relevance from recency data
      // Get all citations from responses in this period and match to recency data
      const periodCitations = periodResponses.flatMap(r => parseCitations(r.citations));
      const recencyScores: number[] = [];
      
      periodCitations.forEach((citation: any) => {
        const originalUrl = citation.url || citation.link;
        if (originalUrl) {
          // Extract actual source URL if it's a Google Translate URL
          const url = extractSourceUrl(originalUrl);
          if (recencyMap.has(url)) {
            const score = recencyMap.get(url)!;
            recencyScores.push(score);
          }
        }
      });
      
      const avgRelevance = recencyScores.length > 0
        ? recencyScores.reduce((sum, score) => sum + score, 0) / recencyScores.length
        : 0;
      
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
  }, [responses, aiThemes, recencyData, calculateAIBasedSentiment]);

  // Prepare chart data for LLM mentions
  const llmMentionChartData = useMemo(() => {
    return llmMentionRankings.map((llm, index) => ({
      name: llm.displayName,
      mentions: llm.mentions,
      color: `hsl(${index * 60}, 70%, 50%)` // Generate different colors
    }));
  }, [llmMentionRankings]);

  return (
    <div className="flex flex-col gap-8 w-full">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
        <p className="text-gray-600">
          Get a comprehensive view of {companyName}'s AI perception metrics, performance trends, and key insights.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        {/* Perception Score Card */}
        <Card className="bg-gray-50/80 border-0 shadow-none rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow duration-200 p-0 relative overflow-hidden h-full min-h-[240px]">
          {/* Top: Score, label, % change */}
          <div className="flex flex-row items-start justify-between px-8 pt-6 pb-1 z-10">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-lg font-bold text-gray-700 tracking-wide">EPS</CardTitle>
                <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-pink-100 text-pink-700 border-pink-200">
                  BETA
                </Badge>
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
                <span className="text-6xl font-extrabold text-gray-900 drop-shadow-sm leading-none">
                  {metrics.perceptionScore}
                </span>
                {perceptionScoreTrend.length > 1 && (() => {
                  const latestScore = perceptionScoreTrend[perceptionScoreTrend.length - 1].score;
                  const previousScore = perceptionScoreTrend[perceptionScoreTrend.length - 2].score;
                  const change = latestScore - previousScore;
                  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
                  
                  return (
                    <span className={`ml-4 flex items-center gap-1 text-xl font-semibold ${direction === 'up' ? 'text-green-600' : direction === 'down' ? 'text-red-600' : 'text-gray-400'}`}
                  style={{marginBottom: 6}}>
                      {direction === 'up' && <TrendingUp className="w-5 h-5" />} 
                      {direction === 'down' && <TrendingDown className="w-5 h-5" />} 
                      {Math.abs(change)}
                </span>
                  );
                })()}
              </div>
            </div>
            {/* Badge in top right */}
            <div className="flex items-start">
              <span className={`px-3 py-1 rounded-full text-base font-semibold mt-1 ${
                metrics.perceptionScore >= 80 ? 'bg-green-100 text-green-800' : metrics.perceptionScore >= 65 ? 'bg-blue-100 text-blue-800' : metrics.perceptionScore >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
              }`}>{metrics.perceptionLabel}</span>
            </div>
          </div>
          {/* Bottom: Chart, visually anchored */}
           <div className="w-full flex-1 flex items-end" style={{ minHeight: 0 }}>
             <div className="w-full" style={{ height: '60px' }}>
               <ChartContainer config={{ score: { label: "Score", color: "#0DBCBA" } }} className="w-full h-full">
                 <AreaChart 
                   data={perceptionScoreTrend.length > 1 ? perceptionScoreTrend : [
                     { date: 'Start', score: metrics.perceptionScore, fullDate: new Date().toISOString(), responseCount: responses.length },
                     { date: 'Today', score: metrics.perceptionScore, fullDate: new Date().toISOString(), responseCount: responses.length }
                   ]} 
                   width={undefined}
                   height={60}
                   margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                 >
                <defs>
                  <linearGradient id="colorPerceptionBg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0DBCBA" stopOpacity={0.18}/>
                    <stop offset="100%" stopColor="#0DBCBA" stopOpacity={0.04}/>
                  </linearGradient>
                </defs>
                 <Area 
                   type="monotone" 
                   dataKey="score" 
                   stroke="#0DBCBA" 
                   strokeWidth={3} 
                   fill="url(#colorPerceptionBg)" 
                   dot={false}
                   isAnimationActive={false} 
                 />
                 </AreaChart>
               </ChartContainer>
             </div>
           </div>
        </Card>
        {/* Score Breakdown Card */}
        <Card 
          className="bg-white rounded-2xl shadow-sm p-0 hover:shadow-md transition-shadow duration-200 cursor-pointer h-full min-h-[240px] flex flex-col" 
          onClick={() => setIsScoreBreakdownModalOpen(true)}
        >
          <CardHeader className="pb-2 pt-6 px-4 sm:px-8 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg font-bold text-gray-700">Breakdown</CardTitle>
              <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-pink-100 text-pink-700 border-pink-200">
                BETA
              </Badge>
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
              const previousPeriod = perceptionScoreTrend.length > 1 ? perceptionScoreTrend[perceptionScoreTrend.length - 2] : null;
              
              const sentimentChange = previousPeriod ? metrics.sentimentScore - previousPeriod.sentiment : 0;
              const visibilityChange = previousPeriod ? metrics.visibilityScore - previousPeriod.visibility : 0;
              const relevanceChange = previousPeriod ? metrics.relevanceScore - previousPeriod.relevance : 0;
              
              const currentSentiment = metrics.sentimentScore;
              const currentVisibility = metrics.visibilityScore;
              const currentRelevance = metrics.relevanceScore;
              
              return (
                <>
            <div className="flex items-center gap-2 sm:gap-3 mb-6">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Sentiment</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${currentSentiment}%` }} />
              </div>
                    <div className="flex items-center gap-1 ml-1 sm:ml-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{currentSentiment}%</span>
                      {previousPeriod && sentimentChange !== 0 && (
                        <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                          sentimentChange > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {sentimentChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
                          {sentimentChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                          <span className="whitespace-nowrap">{Math.abs(sentimentChange)}</span>
                        </span>
                      )}
                    </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 mb-6">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Visibility</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${currentVisibility}%` }} />
              </div>
                    <div className="flex items-center gap-1 ml-1 sm:ml-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{currentVisibility}%</span>
                      {previousPeriod && visibilityChange !== 0 && (
                        <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                          visibilityChange > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {visibilityChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
                          {visibilityChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                          <span className="whitespace-nowrap">{Math.abs(visibilityChange)}</span>
                        </span>
                      )}
                    </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Relevance</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${currentRelevance}%` }} />
              </div>
                    <div className="flex items-center gap-1 ml-1 sm:ml-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{currentRelevance}%</span>
                      {previousPeriod && relevanceChange !== 0 && (
                        <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                          relevanceChange > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {relevanceChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
                          {relevanceChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                          <span className="whitespace-nowrap">{Math.abs(relevanceChange)}</span>
                        </span>
                      )}
            </div>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>
      {/* Key Takeaways - Temporarily Hidden */}
      {/* <div>
        <KeyTakeaways 
          metrics={metrics}
          topCompetitors={normalizedTopCompetitors}
          topCitations={topCitations}
          themesBySentiment={themesBySentiment}
          llmMentionRankings={llmMentionRankings}
          responses={responses}
          talentXProData={talentXProData}
          isPro={isPro}
          attributeInsights={attributeInsights}
          searchResults={searchResults}
        />
      </div> */}

      {/* Summary Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <div>
          <SourcesSummaryCard 
            topCitations={topCitations}
            responses={responses}
            companyName={companyName}
            searchResults={searchResults}
            perceptionScoreTrend={perceptionScoreTrend}
          />
        </div>

        <div>
          <CompetitorsSummaryCard 
            topCompetitors={normalizedTopCompetitors}
            responses={responses}
            companyName={companyName}
            searchResults={searchResults}
            perceptionScoreTrend={perceptionScoreTrend}
          />
        </div>

        <div className="lg:col-span-2 xl:col-span-1">
          <AttributesSummaryCard 
            talentXProData={talentXProData}
            aiThemes={aiThemes}
            companyName={companyName}
            perceptionScoreTrend={perceptionScoreTrend}
          />
        </div>
      </div>









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
              <Card className="border-blue-100 bg-blue-50/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-500" />
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
                    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-blue-100">
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
              <Card className="border-blue-100 bg-gradient-to-br from-blue-50/40 to-indigo-50/30 overflow-hidden">
                <CardContent className="py-5 px-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="relative">
                      <Sparkles className="w-4 h-4 text-blue-500" />
                      <div className="absolute inset-0 animate-ping"><Sparkles className="w-4 h-4 text-blue-400 opacity-30" /></div>
                    </div>
                    <span className="text-sm font-medium text-blue-700">Analyzing...</span>
                  </div>
                  <div className="space-y-0.5">
                    {competitorThinkingSteps.map((step, i) => {
                      const isActive = i === competitorThinkingStep;
                      const isComplete = i < competitorThinkingStep;
                      const isPending = i > competitorThinkingStep;
                      return (
                        <div key={i} className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-500 ${isActive ? 'bg-blue-100/60' : ''}`}
                          style={{ opacity: isPending ? 0.3 : 1, transform: isPending ? 'translateX(4px)' : 'translateX(0)', transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                            {isComplete ? <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> : isActive ? <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />}
                          </div>
                          <span className={`text-xs transition-colors duration-300 ${isActive ? 'text-blue-700 font-medium' : isComplete ? 'text-blue-500' : 'text-gray-400'}`}>{step}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 h-1 bg-blue-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full transition-all duration-700 ease-out"
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

      {/* Score Breakdown Modal */}
      <Dialog open={isScoreBreakdownModalOpen} onOpenChange={setIsScoreBreakdownModalOpen}>
        <DialogContent className="max-w-4xl w-full sm:w-[95vw] p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Understanding Your Score
            </DialogTitle>
          </DialogHeader>
          
          {/* Beta Notice */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 border-blue-200">
                Beta
              </Badge>
              <span className="text-sm text-blue-800 font-medium">
                This feature is currently in beta. We're actively improving the scoring algorithm and welcome your feedback.
              </span>
            </div>
          </div>
          
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-gray-100">
              <TabsTrigger 
                value="overview"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger 
                value="sentiment"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Sentiment
              </TabsTrigger>
              <TabsTrigger 
                value="visibility"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Visibility
              </TabsTrigger>
              <TabsTrigger 
                value="relevance"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Relevance
              </TabsTrigger>
            </TabsList>
            
                        {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              {/* Current Performance Summary */}
              <Card className="bg-gray-50 border-gray-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold text-gray-900">
                    Your Current Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
                    const currentSentiment = metrics.sentimentScore;
                    const currentVisibility = metrics.visibilityScore;
                    const currentRelevance = metrics.relevanceScore;
                    const currentPerceptionScore = metrics.perceptionScore;
                    
                    return (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-green-600">{currentSentiment}%</div>
                            <div className="text-sm text-gray-600">Sentiment</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600">{currentVisibility}%</div>
                            <div className="text-sm text-gray-600">Visibility</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-orange-600">{currentRelevance}%</div>
                            <div className="text-sm text-gray-600">Relevance</div>
                          </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <div className="text-center">
                            <div className="text-3xl font-bold text-gray-900">{currentPerceptionScore}</div>
                            <div className="text-sm text-gray-600">Overall Perception Score</div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Sentiment Tab */}
            <TabsContent value="sentiment" className="space-y-4">
              <Card className="border-l-4 border-l-green-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                    Sentiment Score
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const currentSentiment = metrics.sentimentScore;
                    
                    return (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${currentSentiment}%` }} />
                          </div>
                          <span className="text-xl font-bold text-gray-900 min-w-[60px] text-right">
                            {currentSentiment}%
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 mb-2">What it measures:</p>
                          <ul className="text-sm text-gray-700 space-y-2 ml-4">
                            <li>• Advanced AI-powered thematic analysis of brand perception</li>
                            <li>• Confidence-weighted sentiment scores from extracted themes</li>
                            <li>• Whether mentions are favorable, neutral, or unfavorable</li>
                            <li>• More accurate sentiment analysis beyond simple keyword matching</li>
                            <li>• Context-aware understanding of how your brand is discussed</li>
                          </ul>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Visibility Tab */}
            <TabsContent value="visibility" className="space-y-4">
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                    Visibility Score
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const currentVisibility = metrics.visibilityScore;
                    
                    return (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${currentVisibility}%` }} />
                          </div>
                          <span className="text-xl font-bold text-gray-900 min-w-[60px] text-right">
                            {currentVisibility}%
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 mb-2">What it measures:</p>
                          <ul className="text-sm text-gray-700 space-y-2 ml-4">
                            <li>• How prominently your brand appears in AI responses</li>
                            <li>• The frequency and prominence of mentions across platforms</li>
                            <li>• Whether you're mentioned early or late in responses</li>
                            <li>• Your brand's recognition and recall value</li>
                            <li>• How easily AI models can find and reference your company</li>
                          </ul>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Relevance Tab */}
            <TabsContent value="relevance" className="space-y-4">
              <Card className="border-l-4 border-l-orange-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <div className="w-4 h-4 bg-orange-500 rounded-full"></div>
                    Relevance Score
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const currentRelevance = metrics.relevanceScore;
                    
                    return (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${currentRelevance}%` }} />
                          </div>
                          <span className="text-xl font-bold text-gray-900 min-w-[60px] text-right">
                            {currentRelevance}%
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 mb-2">What it measures:</p>
                          <ul className="text-sm text-gray-700 space-y-2 ml-4">
                            <li>• How recent and timely the content about your brand is</li>
                            <li>• The freshness of information sources and citations</li>
                            <li>• Whether AI responses reference up-to-date information</li>
                            <li>• The recency of news, reviews, and mentions about your company</li>
                            <li>• How current your brand's online presence appears to be</li>
                          </ul>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
});
OverviewTab.displayName = 'OverviewTab';
