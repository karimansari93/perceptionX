import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CitationCount } from "@/types/dashboard";
import { FileText, TrendingUp, TrendingDown } from 'lucide-react';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Favicon } from "@/components/ui/favicon";

interface TimeBasedData {
  name: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface SourcesTabProps {
  topCitations: CitationCount[];
  responses: any[];
  parseCitations: (citations: any) => any[];
}

export const SourcesTab = ({ topCitations, responses, parseCitations }: SourcesTabProps) => {
  const [selectedSource, setSelectedSource] = useState<CitationCount | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);

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
        return Array.isArray(citations) && citations.some((c: any) => c.domain === domain);
      } catch {
        return false;
      }
    });
  };

  const getFavicon = (domain: string): string => {
    return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=32`;
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, ""); // Remove www. if present
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

    return result;
  }, [groupResponsesByTimePeriod]);

  // Calculate all-time citation data with change indicators
  const allTimeCitations = useMemo(() => {
    // Use the topCitations prop instead of recalculating
    const result = topCitations.map(citation => ({
      name: citation.domain,
      count: citation.count,
      change: 0 // Will be updated after timeBasedCitations is calculated
    }));

    return result;
  }, [topCitations]);

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

  const renderAllTimeBar = (data: { name: string; count: number; change?: number }, maxCount: number) => {
    // Calculate the actual percentage width
    const percentage = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
    
    // Truncate labels to 15 characters
    const displayName = getSourceDisplayName(data.name);
    const truncatedName = displayName.length > 15 ? displayName.substring(0, 15) + '...' : displayName;
    
    return (
      <div className="flex items-center py-3 hover:bg-gray-50/50 transition-colors cursor-pointer rounded-lg px-3">
        {/* Source name and favicon */}
        <div className="flex items-center space-x-3 min-w-0 w-1/4 sm:w-1/3 max-w-[180px] sm:max-w-[220px]">
          <Favicon domain={data.name} />
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
            <CardTitle className="text-xl font-semibold">Top Information Sources</CardTitle>
            <CardDescription className="text-base text-gray-600">
              Sources most frequently cited in AI responses about your company
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden p-6">
            <div className="space-y-2 h-full overflow-y-auto relative">
              {allTimeCitationsWithChanges.length > 0 ? (
                (() => {
                  const maxCount = Math.max(...allTimeCitationsWithChanges.map(c => c.count), 1);
                  return allTimeCitationsWithChanges.map((citation, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleSourceClick({ domain: citation.name, count: citation.count })}
                      className="cursor-pointer"
                    >
                      {renderAllTimeBar(citation, maxCount)}
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

      {/* Source Details Modal */}
      {selectedSource && (
        <SourceDetailsModal
          isOpen={isSourceModalOpen}
          onClose={handleCloseSourceModal}
          source={selectedSource}
          responses={getResponsesForSource(selectedSource.domain)}
        />
      )}
    </div>
  );
}; 