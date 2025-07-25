import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target, HelpCircle, X, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import LLMLogo from "@/components/LLMLogo";
import { KeyTakeaways } from "./KeyTakeaways";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartConfig } from "@/components/ui/chart"

interface OverviewTabProps {
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  topCompetitors: { company: string; count: number }[];
  responses: any[]; // Add responses prop
  competitorLoading?: boolean; // Add competitor loading prop
  companyName: string; // <-- Add this
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

export const OverviewTab = ({ 
  metrics, 
  topCitations, 
  topCompetitors, 
  responses,
  competitorLoading = false,
  companyName // <-- Add this
}: OverviewTabProps) => {
  const [selectedSource, setSelectedSource] = useState<CitationCount | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [competitorSnippets, setCompetitorSnippets] = useState<{ snippet: string; full: string }[]>([]);
  const [expandedSnippetIdx, setExpandedSnippetIdx] = useState<number | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string>("");
  const [loadingCompetitorSummary, setLoadingCompetitorSummary] = useState(false);
  const [competitorSummaryError, setCompetitorSummaryError] = useState<string | null>(null);
  const [isMentionsDrawerOpen, setIsMentionsDrawerOpen] = useState(false);
  const [expandedMentionIdx, setExpandedMentionIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Responsive check
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Collapsible Trends & Details
  const [showTrends, setShowTrends] = useState(false);

  // Helper for mini-cards
  const breakdowns = [
    {
      title: 'Sentiment',
      value: Math.round((metrics.averageSentiment + 1) * 50),
      trend: metrics.sentimentTrendComparison,
      color: 'green',
      description: 'How positively your brand is perceived.'
    },
    {
      title: 'Visibility',
      value: Math.round(metrics.averageVisibility),
      trend: metrics.visibilityTrendComparison,
      color: 'blue',
      description: 'How prominently your brand is mentioned.'
    },
    {
      title: 'Competitive',
      value: metrics.perceptionScore > 0 ? Math.round(metrics.perceptionScore * 0.25) : 0, // Approximation
      trend: metrics.citationsTrendComparison, // Use citations trend as a placeholder for now
      color: 'purple',
      description: 'How well you are positioned vs competitors.'
    }
  ];

  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
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

    // Debug logging
    if (import.meta.env.MODE === 'development') {
      console.log('Time-based grouping:', {
        totalResponses: responses.length,
        currentPeriod: current.length,
        previousPeriod: previous.length,
        latestDate: latestDate.toLocaleDateString(),
        uniqueDates: [...new Set(sortedResponses.map(r => new Date(r.tested_at).toDateString()))]
      });
    }

    return { current, previous };
  }, [responses]);

  // Calculate time-based competitor data
  const timeBasedCompetitors = useMemo(() => {
    const { current, previous } = groupResponsesByTimePeriod;
    
    // Get competitor counts for current period
    const currentCompetitors: Record<string, number> = {};
    current.forEach(response => {
      if (response.detected_competitors) {
        const competitors = response.detected_competitors
          .split(',')
          .map(name => normalizeCompetitorName(name))
          .filter(name => 
            name && 
            name.toLowerCase() !== companyName.toLowerCase() &&
            name.length > 1
          );
        
        competitors.forEach(name => {
          currentCompetitors[name] = (currentCompetitors[name] || 0) + 1;
        });
      }
    });

    // Get competitor counts for previous period and calculate average
    const previousCompetitors: Record<string, number> = {};
    const previousUniqueDays = new Set(previous.map(r => new Date(r.tested_at).toDateString()));
    const numPreviousDays = Math.max(1, previousUniqueDays.size);

    previous.forEach(response => {
      if (response.detected_competitors) {
        const competitors = response.detected_competitors
          .split(',')
          .map(name => normalizeCompetitorName(name))
          .filter(name => 
            name && 
            name.toLowerCase() !== companyName.toLowerCase() &&
            name.length > 1
          );
        
        competitors.forEach(name => {
          previousCompetitors[name] = (previousCompetitors[name] || 0) + 1;
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

    // Debug logging
    if (import.meta.env.MODE === 'development') {
      console.log('Time-based competitors:', {
        currentPeriodResponses: current.length,
        previousPeriodResponses: previous.length,
        numPreviousDays: numPreviousDays,
        currentCompetitors: Object.keys(currentCompetitors).length,
        previousCompetitors: Object.keys(previousCompetitors).length,
        totalUniqueCompetitors: allCompetitors.size,
        topCompetitors: result.slice(0, 3).map(c => ({ name: c.name, current: c.current, previous: c.previous, change: c.change }))
      });
    }

    return result;
  }, [groupResponsesByTimePeriod, companyName]);

  // Calculate time-based citation data
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

    // Debug logging
    if (import.meta.env.MODE === 'development') {
      console.log('Time-based citations:', {
        currentPeriodResponses: current.length,
        previousPeriodResponses: previous.length,
        numPreviousDays: numPreviousDays,
        currentCitations: Object.keys(currentCitations).length,
        previousCitations: Object.keys(previousCitations).length,
        totalUniqueDomains: allDomains.size,
        topCitations: result.slice(0, 3).map(c => ({ name: c.name, current: c.current, previous: c.previous, change: c.change }))
      });
    }

    return result;
  }, [groupResponsesByTimePeriod]);

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

  const handleSourceClick = (citation: CitationCount) => {
    setSelectedSource(citation);
    setIsSourceModalOpen(true);
  };

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  const getResponsesForSource = (domain: string) => {
    return responses.filter(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        return Array.isArray(citations) && citations.some(c => c.domain === domain);
      } catch {
        return false;
      }
    });
  };

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

  // Fetch AI summary for competitor when modal opens
  useEffect(() => {
    if (!isCompetitorModalOpen || !selectedCompetitor) return;
    setCompetitorSummary("");
    setCompetitorSummaryError(null);
    setLoadingCompetitorSummary(true);
    const relevantResponses = getFullResponsesForCompetitor(selectedCompetitor);
    if (relevantResponses.length === 0) {
      setCompetitorSummaryError("No responses found for this competitor.");
      setLoadingCompetitorSummary(false);
      return;
    }
    // Build the prompt
    const prompt = `Summarize the following AI responses about \"${selectedCompetitor}\" in one concise paragraph. Highlight what is said about ${selectedCompetitor}, and how this is different from ${companyName}. Focus on key themes, sentiment, and notable comparisons.\n\nResponses:\n${relevantResponses.map(r => r.response_text.slice(0, 1000)).join('\n---\n')}`;
    // Get session and call Gemini endpoint
    const fetchSummary = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setCompetitorSummaryError("Authentication required");
          setLoadingCompetitorSummary(false);
          return;
        }
        const res = await fetch("https://ofyjvfmcgtntwamkubui.supabase.co/functions/v1/test-prompt-gemini", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ prompt })
        });
        const data = await res.json();
        if (data.response) {
          setCompetitorSummary(data.response.trim());
        } else {
          setCompetitorSummaryError(data.error || "No summary generated.");
        }
      } catch (err) {
        setCompetitorSummaryError("Failed to fetch summary.");
      } finally {
        setLoadingCompetitorSummary(false);
      }
    };
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompetitorModalOpen, selectedCompetitor]);

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

  // Aggregate themes by sentiment
  const themesBySentiment = useMemo(() => {
    const allThemes = { positive: [], neutral: [], negative: [] as string[] };
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
    // Deduplicate and take top 3 for each
    return {
      positive: Array.from(new Set(allThemes.positive)).slice(0, 3),
      neutral: Array.from(new Set(allThemes.neutral)).slice(0, 3),
      negative: Array.from(new Set(allThemes.negative)).slice(0, 3),
    };
  }, [responses]);

  // Helper to render a simple comparison bar
  const renderComparisonBar = (data: TimeBasedData, maxCurrent: number, isCompetitor: boolean = false) => {
    const barWidth = maxCurrent > 0 ? (data.current / maxCurrent) * 100 : 0;
    
    return (
      <div className="flex items-center py-1 hover:bg-gray-50/50 transition-colors cursor-pointer">
        <div className="flex items-center space-x-3 min-w-[200px] truncate">
          {!isCompetitor && (
            <img src={getFavicon(data.name)} alt="" className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="text-sm font-medium text-gray-900 truncate">
            {isCompetitor ? data.name : getSourceDisplayName(data.name)}
          </span>
        </div>
        <div className="flex-1 flex items-center gap-2 ml-4">
          <div className="w-[120px]">
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

  const visibilityTrendData = useMemo(() => {
    if (!responses || responses.length === 0) {
      return [];
    }

    const dataByDate: Record<string, { totalScore: number; count: number }> = {};
    
    responses.forEach(response => {
      if (typeof response.visibility_score === 'number') {
        const date = new Date(response.tested_at).toISOString().split('T')[0];
        if (!dataByDate[date]) {
          dataByDate[date] = { totalScore: 0, count: 0 };
        }
        dataByDate[date].totalScore += response.visibility_score;
        dataByDate[date].count += 1;
      }
    });

    const trendData = Object.entries(dataByDate).map(([date, { totalScore, count }]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      "Visibility": Math.round(totalScore / count),
    }));

    return trendData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [responses]);

  const sentimentTrendData = useMemo(() => {
    if (!responses || responses.length === 0) {
      return [];
    }
  
    const dataByDate: Record<string, { totalScore: number; count: number }> = {};
    
    responses.forEach(response => {
      if (typeof response.sentiment_score === 'number') {
        const date = new Date(response.tested_at).toISOString().split('T')[0];
        if (!dataByDate[date]) {
          dataByDate[date] = { totalScore: 0, count: 0 };
        }
        dataByDate[date].totalScore += response.sentiment_score;
        dataByDate[date].count += 1;
      }
    });
  
    const trendData = Object.entries(dataByDate).map(([date, { totalScore, count }]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      "Sentiment": Math.round((totalScore / count) * 100),
    }));
  
    return trendData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [responses]);

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

  // Compute perception score trend by date
  const perceptionScoreTrend = useMemo(() => {
    if (!responses || responses.length === 0) return [];
    // Group responses by date
    const grouped: Record<string, any[]> = {};
    responses.forEach(r => {
      const date = new Date(r.tested_at).toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(r);
    });
    // For each date, calculate perception score using the same formula as in useDashboardData
    return Object.entries(grouped)
      .map(([date, group]) => {
        // Average sentiment
        const avgSentiment = group.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / group.length;
        const normalizedSentiment = Math.max(0, Math.min(100, (avgSentiment + 1) * 50));
        // Average visibility
        const visScores = group.map(r => typeof r.visibility_score === 'number' ? r.visibility_score : undefined).filter((v): v is number => typeof v === 'number');
        const avgVisibility = visScores.length > 0 ? visScores.reduce((sum, v) => sum + v, 0) / visScores.length : 0;
        // Competitive score
        const competitiveResponses = group.filter(r => r.detected_competitors);
        const totalCompetitorMentions = competitiveResponses.reduce((sum, r) => {
          const competitors = r.detected_competitors?.split(',').filter(Boolean) || [];
          return sum + competitors.length;
        }, 0);
        const mentionRankings = group.map(r => r.mention_ranking).filter((r): r is number => typeof r === 'number');
        const avgMentionRanking = mentionRankings.length > 0 ? mentionRankings.reduce((sum, rank) => sum + rank, 0) / mentionRankings.length : 0;
        const competitiveScore = Math.min(100, Math.max(0, (totalCompetitorMentions * 10) + (avgMentionRanking > 0 ? Math.max(0, 100 - (avgMentionRanking * 10)) : 50)));
        // Weighted formula
        const perceptionScore = Math.round(
          (normalizedSentiment * 0.4) +
          (avgVisibility * 0.35) +
          (competitiveScore * 0.25)
        );
        return {
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          score: perceptionScore
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [responses]);

  return (
    <div className="flex flex-col gap-8 w-full">
      <div className="flex flex-col md:flex-row gap-6 w-full">
        {/* Perception Score Card */}
        <Card className="flex-1 bg-gray-50/80 border-0 shadow-none rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow duration-200 p-0 relative overflow-hidden" style={{ minHeight: 220, height: 220 }}>
          {/* Top: Score, label, % change */}
          <div className="flex flex-row items-start justify-between px-8 pt-6 pb-2 z-10">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-lg font-bold text-gray-700 tracking-wide">Perception Score</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 cursor-pointer align-middle">
                        <HelpCircle className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Overall perception score (0-100) combines:<br/>
                      <b>Sentiment</b> (40%), <b>Visibility</b> (35%), <b>Competitive</b> (25%)<br/>
                      Higher scores indicate better brand perception.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-end gap-3 mb-1 mt-2">
                <span className="text-6xl font-extrabold text-gray-900 drop-shadow-sm leading-none">{metrics.perceptionScore}</span>
                <span className={`ml-4 flex items-center gap-1 text-xl font-semibold ${metrics.sentimentTrendComparison.direction === 'up' ? 'text-green-600' : metrics.sentimentTrendComparison.direction === 'down' ? 'text-red-600' : 'text-gray-400'}`}
                  style={{marginBottom: 6}}>
                  {metrics.sentimentTrendComparison.direction === 'up' && <TrendingUp className="w-5 h-5" />} 
                  {metrics.sentimentTrendComparison.direction === 'down' && <TrendingDown className="w-5 h-5" />} 
                  {metrics.sentimentTrendComparison.direction === 'neutral' && null}
                  {metrics.sentimentTrendComparison.direction !== 'neutral' && `${metrics.sentimentTrendComparison.value}%`}
                </span>
              </div>
            </div>
            {/* Badge in top right */}
            <div className="flex items-start">
              <span className={`px-3 py-1 rounded-full text-base font-semibold mt-1 ${metrics.perceptionScore >= 80 ? 'bg-green-100 text-green-800' : metrics.perceptionScore >= 65 ? 'bg-blue-100 text-blue-800' : metrics.perceptionScore >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{metrics.perceptionLabel}</span>
            </div>
          </div>
          {/* Bottom: Chart, visually anchored */}
          {perceptionScoreTrend.length > 1 && (
            <div className="w-full flex-1 flex items-end" style={{ minHeight: 0 }}>
              <AreaChart width={600} height={90} data={perceptionScoreTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPerceptionBg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0DBCBA" stopOpacity={0.18}/>
                    <stop offset="100%" stopColor="#0DBCBA" stopOpacity={0.04}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="score" stroke="#0DBCBA" strokeWidth={3} fill="url(#colorPerceptionBg)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </div>
          )}
        </Card>
        {/* Score Breakdown Card */}
        <Card className="flex-1 bg-white rounded-2xl shadow-sm p-0 flex flex-col justify-between">
          <CardHeader className="pb-2 pt-6 px-8">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg font-bold text-gray-700">Score breakdown</CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 cursor-pointer align-middle">
                      <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Perception Score = (Sentiment + Visibility + Competitive) / 3<br/>
                    Each bar shows your current value for that factor.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-8 pb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="w-28 text-sm font-medium text-gray-700">Sentiment</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${Math.round((metrics.averageSentiment + 1) * 50)}%` }} />
              </div>
              <span className="ml-2 text-sm font-semibold text-gray-700 min-w-[32px] text-right">{Math.round((metrics.averageSentiment + 1) * 50)}%</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-28 text-sm font-medium text-gray-700">Visibility</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.round(metrics.averageVisibility)}%` }} />
              </div>
              <span className="ml-2 text-sm font-semibold text-gray-700 min-w-[32px] text-right">{Math.round(metrics.averageVisibility)}%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 text-sm font-medium text-gray-700">Competitive</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%` }} />
              </div>
              <span className="ml-2 text-sm font-semibold text-gray-700 min-w-[32px] text-right">{metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%</span>
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Key Takeaways */}
      <div>
        <KeyTakeaways 
          metrics={metrics}
          topCompetitors={normalizedTopCompetitors}
          topCitations={topCitations}
          themesBySentiment={themesBySentiment}
        />
      </div>

      {/* Trends & Details Collapsible */}
      <div className="mt-2">
        <button
          className="flex items-center gap-2 text-base font-semibold text-blue-700 hover:underline focus:outline-none mb-2"
          onClick={() => setShowTrends(v => !v)}
        >
          {showTrends ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          Trends & Details
        </button>
        {showTrends && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-2">
            {/* Competitors Card */}
            <Card className="shadow-sm border border-gray-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Top Competitors</CardTitle>
                <CardDescription className="text-sm text-gray-600">
                  Companies most frequently mentioned alongside your brand
                </CardDescription>
              </CardHeader>
              <CardContent>
                {competitorLoading ? (
                  <div className="text-center py-12 text-gray-500">
                    <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300 animate-spin" />
                    <p className="text-sm">Loading competitor data...</p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[300px] overflow-y-auto relative">
                    {timeBasedCompetitors.length > 0 ? (
                      (() => {
                        const maxCurrent = Math.max(...timeBasedCompetitors.map(c => c.current), 1);
                        return timeBasedCompetitors.map((competitor, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleCompetitorClick(competitor.name)}
                          >
                            {renderComparisonBar(competitor, maxCurrent, true)}
                          </div>
                        ));
                      })()
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="text-sm">No competitor mentions found yet.</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            {/* Information Sources Card */}
            <Card className="shadow-sm border border-gray-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Information Sources</CardTitle>
                <CardDescription className="text-sm text-gray-600">
                  The sources most frequently influencing AI responses
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[300px] overflow-y-auto relative">
                  {timeBasedCitations.length > 0 ? (
                    (() => {
                      const maxCurrent = Math.max(...timeBasedCitations.map(c => c.current), 1);
                      return timeBasedCitations.map((citation, idx) => (
                        <div 
                          key={idx} 
                          onClick={() => handleSourceClick({ domain: citation.name, count: citation.current + citation.previous })}
                        >
                          {renderComparisonBar(citation, maxCurrent, false)}
                        </div>
                      ));
                    })()
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-sm">No citations found yet.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Source Details Modal */}
      {selectedSource && (
        <SourceDetailsModal
          isOpen={isSourceModalOpen}
          onClose={handleCloseSourceModal}
          source={selectedSource}
          responses={getResponsesForSource(selectedSource.domain)}
        />
      )}

      {/* Competitor Snippet Modal (Summary Only) */}
      <Dialog open={isCompetitorModalOpen} onOpenChange={handleCloseCompetitorModal}>
        <DialogContent className="max-w-xl w-full sm:max-w-2xl sm:w-[90vw] p-2 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Mentions of {selectedCompetitor}</span>
              <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
            </DialogTitle>
          </DialogHeader>
          {/* AI-generated summary */}
          <div className="mb-4">
            <Card className="bg-gray-50 border border-gray-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <LLMLogo modelName="gemini" size="sm" className="mr-1" />
                  AI Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingCompetitorSummary ? (
                  <div className="w-full">
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-6 w-5/6 mb-2" />
                    <Skeleton className="h-6 w-2/3 mb-2" />
                  </div>
                ) : competitorSummaryError ? (
                  <div className="text-red-600 text-sm py-2">{competitorSummaryError}</div>
                ) : competitorSummary ? (
                  <div className="text-gray-800 text-base mb-3 whitespace-pre-line">
                    <ReactMarkdown>{competitorSummary}</ReactMarkdown>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
          {/* View All Mentions Button */}
          <button
            className="w-full mt-2 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold"
            onClick={() => setIsMentionsDrawerOpen(true)}
            disabled={competitorSnippets.length === 0}
          >
            View All Mentions
          </button>
        </DialogContent>
      </Dialog>

      {/* Mentions Drawer Modal */}
      <Dialog open={isMentionsDrawerOpen} onOpenChange={setIsMentionsDrawerOpen}>
        <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-lg font-semibold">All Mentions of {selectedCompetitor}</DialogTitle>
              <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
            </div>
            <button onClick={() => setIsMentionsDrawerOpen(false)} className="p-2 rounded hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
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
    </div>
  );
};
