import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./MetricCard";
import { DashboardMetrics, CitationCount } from "@/types/dashboard";
import { TrendingUp, FileText, MessageSquare, BarChart3, Target } from 'lucide-react';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from 'react-markdown';
import { Badge } from "@/components/ui/badge";

interface OverviewTabProps {
  metrics: DashboardMetrics;
  topCitations: CitationCount[];
  topCompetitors: { company: string; count: number }[];
  responses: any[]; // Add responses prop
}

export const OverviewTab = ({ metrics, topCitations, topCompetitors, responses }: OverviewTabProps) => {
  const [selectedSource, setSelectedSource] = useState<CitationCount | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [competitorSnippets, setCompetitorSnippets] = useState<{ snippet: string; full: string }[]>([]);
  const [expandedSnippetIdx, setExpandedSnippetIdx] = useState<number | null>(null);

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

  return (
    <div className="space-y-8">
      {/* Metrics Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Average Sentiment"
          value={
            metrics.sentimentLabel === 'Neutral'
              ? 'Normal'
              : `${Math.round(Math.abs(metrics.averageSentiment * 100))}% ${metrics.sentimentLabel}`
          }
          subtitle={metrics.sentimentLabel === 'Neutral' ? 'Normal' : metrics.sentimentLabel}
          icon={TrendingUp}
          iconColor="text-gray-400"
          trend={metrics.sentimentTrendComparison}
        />
        <MetricCard
          title="Total Citations"
          value={metrics.totalCitations.toString()}
          subtitle={`${metrics.uniqueDomains} unique domains`}
          icon={FileText}
          iconColor="text-gray-400"
        />
        <MetricCard
          title="Total Responses"
          value={metrics.totalResponses.toString()}
          subtitle="AI responses analyzed"
          icon={MessageSquare}
          iconColor="text-gray-400"
        />
        <MetricCard
          title="Average Visibility"
          value={`${Math.round(metrics.averageVisibility)}%`}
          subtitle="Company mention prominence"
          icon={Target}
          iconColor="text-gray-400"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Information Sources</CardTitle>
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
                        <div className="flex items-center space-x-3 min-w-[200px]">
                          <img src={getFavicon(citation.domain)} alt="" className="w-4 h-4" />
                          <span className="text-sm font-medium text-gray-900">{citation.domain}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-4 inline-flex items-center">
                            <div 
                              className="h-full bg-pink-100 rounded-full transition-all duration-300" 
                              style={{ width: `${(citation.count / maxCount) * 120}px`, minWidth: '12px' }} 
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

        <Card className="shadow-sm border border-gray-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Top Competitors</CardTitle>
            <CardDescription className="text-sm text-gray-600">
              Companies most frequently mentioned alongside your brand
            </CardDescription>
          </CardHeader>
          <CardContent className="relative">
            {/* Match Information Sources bar style for Top Competitors */}
            {(() => {
              const maxCount = topCompetitors.length > 0 ? topCompetitors[0].count : 1;
              return (
                <div className="space-y-2 max-h-[300px] overflow-y-auto relative">
                  {topCompetitors.length > 0 ? (
                    topCompetitors.map((competitor, idx) => (
                      <div
                        key={idx}
                        className="flex items-center py-1 hover:bg-gray-50/50 transition-colors cursor-pointer"
                        onClick={() => handleCompetitorClick(competitor.company)}
                      >
                        <div className="flex items-center space-x-3 min-w-[200px]">
                          <span className="text-sm font-medium text-gray-900">{competitor.company}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-4 inline-flex items-center">
                            <div
                              className="h-full bg-blue-100 rounded-full transition-all duration-300"
                              style={{ width: `${(competitor.count / maxCount) * 120}px`, minWidth: '12px' }}
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
            })()}
          </CardContent>
        </Card>
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

      {/* Competitor Snippet Modal */}
      <Dialog open={isCompetitorModalOpen} onOpenChange={handleCloseCompetitorModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Mentions of {selectedCompetitor}</span>
              <Badge variant="secondary">{competitorSnippets.length} mentions</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {competitorSnippets.length > 0 ? (
              competitorSnippets.map((item, idx) => (
                <div key={idx} className="p-2 bg-gray-50 rounded border text-sm text-gray-800">
                  <div className="flex flex-col gap-1">
                    <span><ReactMarkdown>{`...${item.snippet}...`}</ReactMarkdown></span>
                    <button
                      className="text-xs text-blue-600 underline self-start mt-1 hover:text-blue-800"
                      onClick={() => handleExpandSnippet(idx)}
                      type="button"
                    >
                      {expandedSnippetIdx === idx ? 'Hide full response' : 'Show full response'}
                    </button>
                    {expandedSnippetIdx === idx && (
                      <div className="mt-2 p-2 bg-white border rounded text-xs text-gray-700 whitespace-pre-line">
                        <ReactMarkdown>{item.full}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-gray-500 text-sm">No mentions found in responses.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
