import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount, LLMMentionRanking } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target, HelpCircle, X, TrendingDown } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LLMLogo from "@/components/LLMLogo";
import { KeyTakeaways } from "./KeyTakeaways";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Favicon } from "@/components/ui/favicon";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, BarChart, Bar, ResponsiveContainer, Cell } from "recharts"
import { ChartConfig } from "@/components/ui/chart"

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
  companyName, // <-- Add this
  llmMentionRankings,
  talentXProData = [],
  isPro = false
}: OverviewTabProps) => {
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
  const [isScoreBreakdownModalOpen, setIsScoreBreakdownModalOpen] = useState(false);

  // Responsive check
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);



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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        {/* Perception Score Card */}
        <Card className="bg-gray-50/80 border-0 shadow-none rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow duration-200 p-0 relative overflow-hidden h-full min-h-[240px]">
          {/* Top: Score, label, % change */}
          <div className="flex flex-row items-start justify-between px-8 pt-6 pb-1 z-10">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-lg font-bold text-gray-700 tracking-wide">Score</CardTitle>
                <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-pink-100 text-pink-700 border-pink-200">
                  Beta
                </Badge>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 cursor-pointer align-middle">
                        <HelpCircle className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Your perception score is an aggregate of sentiment, visibility and competitive scores.
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
          <div className="w-full flex-1 flex items-end" style={{ minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart 
                data={perceptionScoreTrend.length > 1 ? perceptionScoreTrend : [
                  { date: 'Start', score: metrics.perceptionScore },
                  { date: 'Today', score: metrics.perceptionScore }
                ]} 
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
            </ResponsiveContainer>
          </div>
        </Card>
        {/* Score Breakdown Card */}
        <Card 
          className="bg-white rounded-2xl shadow-sm p-0 hover:shadow-md transition-shadow duration-200 cursor-pointer h-full min-h-[240px] flex flex-col" 
          onClick={() => setIsScoreBreakdownModalOpen(true)}
        >
          <CardHeader className="pb-2 pt-6 px-4 sm:px-8 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg font-bold text-gray-700">Score breakdown</CardTitle>
              <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-pink-100 text-pink-700 border-pink-200">
                Beta
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
            <div className="flex items-center gap-2 sm:gap-3 mb-6">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Sentiment</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${Math.round((metrics.averageSentiment + 1) * 50)}%` }} />
              </div>
              <span className="ml-1 sm:ml-2 text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{Math.round((metrics.averageSentiment + 1) * 50)}%</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 mb-6">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Visibility</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.round(metrics.averageVisibility)}%` }} />
              </div>
              <span className="ml-1 sm:ml-2 text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{Math.round(metrics.averageVisibility)}%</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="w-20 sm:w-28 text-xs sm:text-sm font-medium text-gray-700">Competitive</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%` }} />
              </div>
              <span className="ml-1 sm:ml-2 text-xs sm:text-sm font-semibold text-gray-700 min-w-[24px] sm:min-w-[32px] text-right">{metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%</span>
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
          llmMentionRankings={llmMentionRankings}
          responses={responses}
          talentXProData={talentXProData}
          isPro={isPro}
        />
      </div>









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
                value="competitive"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                Competitive
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{Math.round((metrics.averageSentiment + 1) * 50)}%</div>
                      <div className="text-sm text-gray-600">Sentiment</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{Math.round(metrics.averageVisibility)}%</div>
                      <div className="text-sm text-gray-600">Visibility</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">{metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%</div>
                      <div className="text-sm text-gray-600">Competitive</div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-gray-900">{metrics.perceptionScore}</div>
                      <div className="text-sm text-gray-600">Overall Perception Score</div>
                    </div>
                  </div>
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
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${Math.round((metrics.averageSentiment + 1) * 50)}%` }} />
                    </div>
                    <span className="text-xl font-bold text-gray-900 min-w-[60px] text-right">
                      {Math.round((metrics.averageSentiment + 1) * 50)}%
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 mb-2">What it measures:</p>
                    <ul className="text-sm text-gray-700 space-y-2 ml-4">
                      <li>• How positively or negatively AI models perceive your brand</li>
                      <li>• The emotional tone and sentiment in responses about your company</li>
                      <li>• Whether mentions are favorable, neutral, or unfavorable</li>
                      <li>• The overall brand sentiment across different AI platforms</li>
                    </ul>
                  </div>
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
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.round(metrics.averageVisibility)}%` }} />
                    </div>
                    <span className="text-xl font-bold text-gray-900 min-w-[60px] text-right">
                      {Math.round(metrics.averageVisibility)}%
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
                </CardContent>
              </Card>
            </TabsContent>

            {/* Competitive Tab */}
            <TabsContent value="competitive" className="space-y-4">
              <Card className="border-l-4 border-l-purple-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <div className="w-4 h-4 bg-purple-500 rounded-full"></div>
                    Competitive Score
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%` }} />
                    </div>
                    <span className="text-xl font-bold text-gray-900 min-w-[60px] text-right">
                      {metrics.perceptionScore > 0 ? Math.round((metrics.perceptionScore + 0.0001) / 3) : 0}%
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 mb-2">What it measures:</p>
                    <ul className="text-sm text-gray-700 space-y-2 ml-4">
                      <li>• How well you compete against other companies in your space</li>
                      <li>• Your mention ranking compared to competitors</li>
                      <li>• Whether you're mentioned alongside or instead of competitors</li>
                      <li>• Your competitive positioning in the market</li>
                      <li>• How often you're the preferred choice over alternatives</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
};
