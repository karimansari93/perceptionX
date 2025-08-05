import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingUp, TrendingDown, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import LLMLogo from "@/components/LLMLogo";
import { getLLMDisplayName } from "@/config/llmLogos";

interface TimeBasedData {
  name: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface CompetitorsTabProps {
  topCompetitors: { company: string; count: number }[];
  responses: any[];
  companyName: string;
}

export const CompetitorsTab = ({ topCompetitors, responses, companyName }: CompetitorsTabProps) => {
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [competitorSnippets, setCompetitorSnippets] = useState<{ snippet: string; full: string }[]>([]);
  const [expandedSnippetIdx, setExpandedSnippetIdx] = useState<number | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string>("");
  const [loadingCompetitorSummary, setLoadingCompetitorSummary] = useState(false);
  const [competitorSummaryError, setCompetitorSummaryError] = useState<string | null>(null);
  const [isMentionsDrawerOpen, setIsMentionsDrawerOpen] = useState(false);
  const [expandedMentionIdx, setExpandedMentionIdx] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState<{ domain: string; count: number } | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [showAllCompetitorSources, setShowAllCompetitorSources] = useState(false);

  // Helper to normalize competitor names
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

  // Helper to get sources contributing to competitor mentions
  const getCompetitorSources = (competitorName: string) => {
    const sourceCounts: Record<string, number> = {};
    
    responses.forEach(response => {
      // Check if response mentions the competitor
      if (response.response_text?.toLowerCase().includes(competitorName.toLowerCase())) {
        // Parse citations from the response
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          
          if (Array.isArray(citations)) {
            citations.forEach((citation: any) => {
              if (citation.domain) {
                sourceCounts[citation.domain] = (sourceCounts[citation.domain] || 0) + 1;
              }
            });
          }
        } catch {
          // Skip invalid citations
        }
      }
    });
    
    // Convert to array and sort by count
    return Object.entries(sourceCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Helper to get favicon for a domain
  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    // Remove www. and domain extension
    let name = domain.replace(/^www\./, "");
    name = name.replace(/\.(com|org|net|io|co|edu|gov|info|biz|us|uk|ca|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog|io|co|us|ca|uk|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog)(\.[a-z]{2})?$/, "");
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
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

    return result;
  }, [groupResponsesByTimePeriod, companyName]);

  // Calculate all-time competitor data
  const allTimeCompetitors = useMemo(() => {
    // Get competitor counts across all time
    const competitorCounts: Record<string, number> = {};
    
    responses.forEach(response => {
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
          competitorCounts[name] = (competitorCounts[name] || 0) + 1;
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
    setShowAllCompetitorSources(false);
    setIsCompetitorModalOpen(true);
  };

  const handleCloseCompetitorModal = () => {
    setIsCompetitorModalOpen(false);
    setSelectedCompetitor(null);
    setCompetitorSnippets([]);
    setShowAllCompetitorSources(false);
  };

  const handleSourceClick = (source: { domain: string; count: number }) => {
    setSelectedSource(source);
    setIsSourceModalOpen(true);
  };

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  // Helper to get all full responses mentioning a competitor
  const getFullResponsesForCompetitor = (competitor: string) => {
    const competitorPattern = `(?:\\*\\*|__)?${competitor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:\\*\\*|__)?[\\s]*[:*\-]*`;
    const regex = new RegExp(competitorPattern, 'i');
    return responses.filter(r => r.response_text && regex.test(r.response_text));
  };

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

  const renderAllTimeBar = (data: { name: string; count: number; change?: number }, maxCount: number) => {
    // Calculate the actual percentage width
    const percentage = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
    
    // Truncate labels to 15 characters
    const displayName = data.name;
    const truncatedName = displayName.length > 15 ? displayName.substring(0, 15) + '...' : displayName;
    
    // Get favicon URL for competitor
    const faviconUrl = getCompetitorFavicon(displayName);
    const initials = displayName.charAt(0).toUpperCase();
    
    return (
      <div 
        className="flex items-center py-3 hover:bg-gray-50/50 transition-colors cursor-pointer rounded-lg px-3"
        onClick={() => handleCompetitorClick(data.name)}
      >
        {/* Competitor name with favicon */}
        <div className="flex items-center space-x-3 min-w-0 w-1/4 sm:w-1/3 max-w-[180px] sm:max-w-[220px]">
          <div className="w-4 h-4 flex-shrink-0 bg-blue-100 rounded flex items-center justify-center">
            {faviconUrl ? (
              <img 
                src={faviconUrl} 
                alt={`${displayName} favicon`}
                className="w-full h-full rounded object-contain"
                onError={(e) => {
                  // Fallback to initials if favicon fails to load
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
                style={{ display: 'block' }}
              />
            ) : null}
            <span 
              className="text-xs font-bold text-blue-600"
              style={{ display: faviconUrl ? 'none' : 'flex' }}
            >
              {initials}
            </span>
          </div>
          <span className="text-sm font-medium text-gray-900 truncate" title={displayName}>
            {truncatedName}
          </span>
        </div>
        
        {/* Bar chart - RESPONSIVE AND FULL WIDTH */}
        <div className="flex-1 mx-3 sm:mx-4 bg-gray-200 rounded-full h-4 relative min-w-0">
          <div
            className="h-4 rounded-full absolute left-0 top-0"
            style={{ 
              width: `${percentage}%`,
              backgroundColor: '#0DBCBA'
            }}
          />
        </div>
        
        {/* Count and change indicators */}
        <div className="flex items-center min-w-[60px] sm:min-w-[80px] justify-end">
          <span className="text-sm font-semibold text-gray-900">
            {data.count}
          </span>
          {data.change !== undefined && data.change !== 0 && (
            <div className={`flex items-center text-xs ml-2 ${
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
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <Card className="shadow-sm border border-gray-200 h-full flex flex-col">
          <CardHeader className="pb-4 flex-shrink-0">
            <CardTitle className="text-xl font-semibold">Top Competitors</CardTitle>
            <CardDescription className="text-base text-gray-600">
              Companies most frequently mentioned alongside {companyName} in candidate searches
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden p-6">
            <div className="space-y-2 h-full overflow-y-auto relative">
              {allTimeCompetitorsWithChanges.length > 0 ? (
                (() => {
                  const maxCount = Math.max(...allTimeCompetitorsWithChanges.map(c => c.count), 1);
                  return allTimeCompetitorsWithChanges.map((competitor, idx) => (
                    <div 
                      key={idx} 
                      className="cursor-pointer"
                    >
                      {renderAllTimeBar(competitor, maxCount)}
                    </div>
                  ));
                })()
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-400">🏢</span>
                  </div>
                  <p className="text-sm">No competitor mentions found yet.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Competitor Snippet Modal (Summary Only) */}
      <Dialog open={isCompetitorModalOpen} onOpenChange={handleCloseCompetitorModal}>
        <DialogContent className="max-w-xl w-full sm:max-w-2xl sm:w-[90vw] p-2 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img 
                src={getCompetitorFavicon(selectedCompetitor || '')} 
                alt={`${selectedCompetitor} favicon`}
                className="w-5 h-5 rounded"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
                style={{ display: 'block' }}
              />
              <span>{selectedCompetitor}</span>
              <Badge variant="secondary">{getFullResponsesForCompetitor(selectedCompetitor || '').length} mentions</Badge>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* MODELS ROW - matching PromptsModal style */}
            {selectedCompetitor && (() => {
              const competitorResponses = getFullResponsesForCompetitor(selectedCompetitor);
              const uniqueLLMs = Array.from(new Set(competitorResponses.map(r => r.ai_model).filter(Boolean)));
              
              return (
                <div className="flex flex-row gap-8 mt-1 mb-1 w-full">
                  {/* Models */}
                  <div className="flex flex-col items-start min-w-[120px]">
                    <span className="text-xs text-gray-400 font-medium mb-1">Models</span>
                    <div className="flex flex-row flex-wrap items-center gap-2">
                      {uniqueLLMs.length === 0 ? (
                        <span className="text-xs text-gray-400">None</span>
                      ) : (
                        uniqueLLMs.map(model => (
                          <span key={model} className="inline-flex items-center">
                            <LLMLogo modelName={model} size="sm" className="mr-1" />
                            <span className="text-xs text-gray-700 mr-2">{getLLMDisplayName(model)}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Summary Card - matching PromptsModal style */}
            <div className="mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingCompetitorSummary ? (
                    <div className="w-full">
                      <Skeleton className="h-6 w-3/4 mb-2" />
                      <Skeleton className="h-6 w-5/6 mb-2" />
                      <Skeleton className="h-6 w-2/3 mb-2" />
                      <Skeleton className="h-6 w-1/2 mb-2" />
                    </div>
                  ) : competitorSummaryError ? (
                    <div className="text-red-600 text-sm py-2">{competitorSummaryError}</div>
                  ) : competitorSummary ? (
                    <>
                      <div className="text-gray-800 text-base mb-3 whitespace-pre-line">
                        <ReactMarkdown>{competitorSummary}</ReactMarkdown>
                      </div>
                      
                      {/* Sources section - matching PromptsModal style */}
                      {selectedCompetitor && (() => {
                        const competitorSources = getCompetitorSources(selectedCompetitor);
                        const topSources = showAllCompetitorSources ? competitorSources : competitorSources.slice(0, 5);
                        const hasMoreSources = competitorSources.length > 5;
                        
                        return competitorSources.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span className="text-xs text-gray-500">Sources:</span>
                            {topSources.map((source, index) => (
                              <div
                                key={index}
                                onClick={() => handleSourceClick(source)}
                                className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-full text-xs font-medium text-gray-800 transition-colors border border-gray-200 cursor-pointer"
                              >
                                <img
                                  src={getFavicon(source.domain)}
                                  alt=""
                                  className="w-4 h-4 mr-1 rounded"
                                  style={{ background: '#fff', display: 'block' }}
                                  onError={e => { e.currentTarget.style.display = 'none'; }}
                                />
                                {getSourceDisplayName(source.domain)}
                                <span className="ml-1 text-gray-500">({source.count})</span>
                              </div>
                            ))}
                            {hasMoreSources && (
                              <button
                                onClick={() => setShowAllCompetitorSources(!showAllCompetitorSources)}
                                className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors font-medium"
                              >
                                {showAllCompetitorSources 
                                  ? `Show Less` 
                                  : `+${competitorSources.length - 5} more`
                                }
                              </button>
                            )}
                          </div>
                        ) : null;
                      })()}
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
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
            {competitorSnippets.length > 0 ? (
              competitorSnippets.map((item, idx) => {
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

      {/* Source Modal */}
      <Dialog open={isSourceModalOpen} onOpenChange={handleCloseSourceModal}>
        <DialogContent className="max-w-xl w-full sm:max-w-2xl sm:w-[90vw] p-2 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img 
                src={getFavicon(selectedSource?.domain || '')} 
                alt={`${selectedSource?.domain} favicon`}
                className="w-5 h-5 rounded"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <span>Source: {selectedSource && getSourceDisplayName(selectedSource.domain)}</span>
              <Badge variant="secondary">
                {selectedSource?.count} {selectedSource?.count === 1 ? 'mention' : 'mentions'}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              <p>This source contributes to {selectedCompetitor}'s presence in your analysis.</p>
            </div>
            
            {/* Show responses that mention both the competitor and this source */}
            {selectedSource && selectedCompetitor && (() => {
              const relevantResponses = responses.filter(response => {
                // Check if response mentions both the competitor and has this source
                const mentionsCompetitor = response.response_text?.toLowerCase().includes(selectedCompetitor.toLowerCase());
                if (!mentionsCompetitor) return false;
                
                try {
                  const citations = typeof response.citations === 'string' 
                    ? JSON.parse(response.citations) 
                    : response.citations;
                  
                  if (Array.isArray(citations)) {
                    return citations.some((citation: any) => citation.domain === selectedSource.domain);
                  }
                } catch {
                  return false;
                }
                return false;
              });
              
              return (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Responses mentioning {selectedCompetitor} from {getSourceDisplayName(selectedSource.domain)}:
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {relevantResponses.slice(0, 5).map((response, index) => (
                      <div key={index} className="p-3 bg-gray-50 rounded-lg text-sm text-gray-800">
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: highlightCompetitor(response.response_text?.slice(0, 200) + '...', selectedCompetitor)
                          }}
                        />
                      </div>
                    ))}
                    {relevantResponses.length > 5 && (
                      <div className="text-xs text-gray-500 text-center py-2">
                        Showing first 5 of {relevantResponses.length} responses
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}; 