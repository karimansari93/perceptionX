import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target, HelpCircle, X } from 'lucide-react';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import LLMLogo from "@/components/LLMLogo";
import { KeyTakeaways } from "./KeyTakeaways";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface OverviewTabProps {
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  topCompetitors: { company: string; count: number }[];
  responses: any[]; // Add responses prop
  competitorLoading?: boolean; // Add competitor loading prop
  companyName: string; // <-- Add this
}

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

  const getFavicon = (domain: string): string => {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

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
  const getSourceDisplayName = (domain: string) => {
    // Remove www. and domain extension
    let name = domain.replace(/^www\./, "");
    name = name.replace(/\.(com|org|net|io|co|edu|gov|info|biz|us|uk|ca|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog|io|co|us|ca|uk|au|in|de|fr|jp|ru|ch|it|nl|se|no|es|mil|tv|me|ai|ly|app|site|online|tech|dev|xyz|pro|club|store|blog)(\.[a-z]{2})?$/, "");
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column - Main Content */}
      <div className="lg:col-span-2 space-y-8">
        {/* Metrics Grid */}
        <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
          <MetricCard
            title="Average Sentiment"
            value={metrics.totalResponses && metrics.totalResponses > 0 ? (() => {
              const total = metrics.totalResponses || 1;
              const positivePct = (metrics.positiveCount / total) * 100;
              const negativePct = (metrics.negativeCount / total) * 100;
              if (positivePct >= 60) return 'Positive';
              if (negativePct >= 40) return 'Negative';
              return 'Normal';
            })() : 'No data available'}
            subtitle={metrics.totalResponses && metrics.totalResponses > 0 ? `${metrics.positiveCount} positive, ${metrics.neutralCount} neutral, ${metrics.negativeCount} negative` : 'No sentiment data to display'}
            trend={metrics.totalResponses && metrics.totalResponses > 0 ? metrics.sentimentTrendComparison : undefined}
            tooltip="Overall sentiment category based on the distribution of positive, neutral, and negative responses."
          />
          <MetricCard
            title="Average Visibility"
            value={metrics.totalResponses && metrics.totalResponses > 0 ? `${Math.round(metrics.averageVisibility)}%` : 'No data available'}
            subtitle={metrics.totalResponses && metrics.totalResponses > 0 ? 'Company mention prominence' : 'No visibility data to display'}
            trend={metrics.totalResponses && metrics.totalResponses > 0 ? metrics.visibilityTrendComparison : undefined}
            tooltip="How prominently your company is mentioned in AI responses, on average."
          />
          <MetricCard
            title="Total Citations"
            value={metrics.totalCitations && metrics.totalCitations > 0 ? metrics.totalCitations.toString() : 'No data available'}
            subtitle={metrics.totalCitations && metrics.totalCitations > 0 ? `${metrics.uniqueDomains} unique domains` : 'No citation data to display'}
            trend={metrics.totalCitations && metrics.totalCitations > 0 ? metrics.citationsTrendComparison : undefined}
            tooltip="Total number of source citations found in AI responses, and how many unique domains they come from."
          />
        </div>

        {/* Competitors and Information Sources Row */}
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
          {/* Competitors Card */}
          <Card className="shadow-sm border border-gray-200">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-1">
                <CardTitle className="text-lg font-semibold">Top Competitors</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 cursor-pointer align-middle">
                        <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Companies most often mentioned alongside your brand in AI responses.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <CardDescription className="text-sm text-gray-600">
                Companies most frequently mentioned alongside your brand
              </CardDescription>
            </CardHeader>
            <CardContent className="relative">
              {competitorLoading ? (
                <div className="text-center py-12 text-gray-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300 animate-spin" />
                  <p className="text-sm">Loading competitor data...</p>
                </div>
              ) : (
                // Match Information Sources bar style for Top Competitors
                (() => {
                  const maxCount = normalizedTopCompetitors.length > 0 ? normalizedTopCompetitors[0].count : 1;
                  return (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto relative">
                      {normalizedTopCompetitors.length > 0 ? (
                        normalizedTopCompetitors.map((competitor, idx) => (
                          <div
                            key={idx}
                            className="flex items-center py-1 hover:bg-gray-50/50 transition-colors cursor-pointer"
                            onClick={() => handleCompetitorClick(competitor.company)}
                          >
                            <div className="flex items-center space-x-3 min-w-[200px]">
                              <span className="text-sm font-medium text-gray-900">{competitor.company}</span>
                            </div>
                            <div className="flex-1 flex items-center gap-2 ml-4">
                              <div className="h-4 inline-flex items-center w-[120px]">
                                <div
                                  className="h-full bg-blue-100 rounded-full transition-all duration-300"
                                  style={{ width: `${(competitor.count / maxCount) * 100}%`, minWidth: '12px' }}
                                />
                                <span className="text-sm font-semibold text-blue-900 ml-2" style={{whiteSpace: 'nowrap'}}>{competitor.count}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-12 text-gray-500">
                          <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                          <p className="text-sm">No competitor mentions found yet.</p>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </CardContent>
          </Card>

          {/* Information Sources Card */}
          <Card className="shadow-sm border border-gray-200">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-1">
                <CardTitle className="text-lg font-semibold">Information Sources</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 cursor-pointer align-middle">
                        <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Websites and sources most frequently cited in AI responses.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <CardDescription className="text-sm text-gray-600">
                The sources most frequently influencing AI responses
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Find the max count for scaling bars */}
              {(() => {
                const maxCount = topCitations.length > 0 ? topCitations[0].count : 1;
                return (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto relative">
                    {topCitations.length > 0 ? (
                      topCitations.map((citation, idx) => (
                        <div 
                          key={idx} 
                          className="flex items-center py-1 hover:bg-gray-50/50 transition-colors cursor-pointer"
                          onClick={() => handleSourceClick(citation)}
                        >
                          <div className="flex items-center min-w-[220px] w-[220px] space-x-3">
                            <img src={getFavicon(citation.domain)} alt="" className="w-4 h-4" />
                            <span className="text-sm font-medium text-gray-900 truncate max-w-[170px]">{getSourceDisplayName(citation.domain)}</span>
                          </div>
                          <div className="flex-1 flex items-center gap-2 ml-4">
                            <div className="h-4 inline-flex items-center w-full max-w-[120px]">
                              <div 
                                className="h-full bg-pink-100 rounded-full transition-all duration-300" 
                                style={{ width: `${(citation.count / maxCount) * 100}%`, minWidth: '12px' }} 
                              />
                              <span className="text-sm font-semibold text-pink-900 ml-2" style={{whiteSpace: 'nowrap'}}>{citation.count}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="text-sm">No citations found yet.</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right Column - Fixed KeyTakeaways */}
      <div className="lg:col-span-1">
        <div className="sticky top-4">
          <KeyTakeaways 
            metrics={metrics}
            topCompetitors={topCompetitors}
            topCitations={topCitations}
          />
        </div>
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
