import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CitationCount } from "@/types/dashboard";
import { FileText, TrendingUp, TrendingDown, Check, X } from 'lucide-react';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Favicon } from "@/components/ui/favicon";
import { categorizeSourceByMediaType, getMediaTypeInfo, MEDIA_TYPE_DESCRIPTIONS } from "@/utils/sourceConfig";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSubscription } from "@/hooks/useSubscription";

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
  companyName?: string;
  searchResults?: any[];
  currentCompanyId?: string;
}

export const SourcesTab = ({ topCitations, responses, parseCitations, companyName, searchResults = [], currentCompanyId }: SourcesTabProps) => {
  const { isPro } = useSubscription();
  
  // CRITICAL: Filter topCitations to only include domains that appear in responses for the current company
  // This is a defensive filter to ensure we never show cross-company data
  const filteredTopCitations = useMemo(() => {
    if (!companyName) return topCitations;
    
    return topCitations.filter(citation => {
      // Check if any response cites this domain
      const hasCompanyResponse = responses.some(response => {
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          return Array.isArray(citations) && citations.some((c: any) => c.domain === citation.domain);
        } catch {
          return false;
        }
      });
      
      // Also check search results
      const hasSearchResult = searchResults.some(result => result.domain === citation.domain);
      
      return hasCompanyResponse || hasSearchResult;
    });
  }, [topCitations, responses, searchResults, companyName]);
  
  const [selectedSource, setSelectedSource] = useState<CitationCount | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [showAllSources] = useState(true);
  const [selectedMediaTypeFilter, setSelectedMediaTypeFilter] = useState<string | null>(null);
  const [selectedSourceTypeFilter, setSelectedSourceTypeFilter] = useState<'all' | 'ai-responses' | 'search-results'>('all');
  const [selectedCompanyMentionedFilter, setSelectedCompanyMentionedFilter] = useState<'all' | 'mentioned' | 'not-mentioned'>('all');
  
  // Media type editing state
  const [editingMediaType, setEditingMediaType] = useState<string | null>(null);
  const [customMediaTypes, setCustomMediaTypes] = useState<Record<string, string>>({});


  const handleSourceClick = (citation: CitationCount) => {
    setSelectedSource(citation);
    setIsSourceModalOpen(true);
  };

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  const handleMediaTypeClick = (mediaType: string) => {
    if (selectedMediaTypeFilter === mediaType) {
      // If clicking the same media type, clear the filter
      setSelectedMediaTypeFilter(null);
    } else {
      // Set the new filter
      setSelectedMediaTypeFilter(mediaType);
    }
  };

  const handleSourceTypeClick = (sourceType: 'all' | 'ai-responses' | 'search-results') => {
    setSelectedSourceTypeFilter(sourceType);
  };

  const handleMediaTypeDropdownChange = (value: string) => {
    if (value === 'all') {
      setSelectedMediaTypeFilter(null);
    } else {
      setSelectedMediaTypeFilter(value);
    }
  };

  const handleSourceTypeDropdownChange = (value: string) => {
    if (value === 'all') {
      setSelectedSourceTypeFilter('all');
    } else {
      setSelectedSourceTypeFilter(value as 'ai-responses' | 'search-results');
    }
  };

  const handleCompanyMentionedDropdownChange = (value: string) => {
    if (value === 'all') {
      setSelectedCompanyMentionedFilter('all');
    } else {
      setSelectedCompanyMentionedFilter(value as 'mentioned' | 'not-mentioned');
    }
  };

  // Media type editing functions
  const handleMediaTypeEdit = (domain: string) => {
    setEditingMediaType(domain);
  };

  const handleMediaTypeSave = (domain: string, newMediaType: string) => {
    setCustomMediaTypes(prev => ({
      ...prev,
      [domain]: newMediaType
    }));
    setEditingMediaType(null);
  };

  const handleMediaTypeCancel = () => {
    setEditingMediaType(null);
  };

  const getEffectiveMediaType = (domain: string, sourceResponses: any[]) => {
    // Check if there's a custom override
    if (customMediaTypes[domain]) {
      return customMediaTypes[domain];
    }
    // Otherwise use the automatic categorization
    return categorizeSourceByMediaType(domain, sourceResponses, companyName);
  };

  // Helper function to check if a domain comes from search results
  const isDomainFromSearchResults = (domain: string) => {
    return searchResults.some(result => result.domain === domain);
  };

  // Helper function to check if a domain comes from AI responses
  const isDomainFromAIResponses = (domain: string) => {
    return responses.some(response => {
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

  // Helper function to check if a domain has company mentions
  const hasDomainCompanyMentions = (domain: string) => {
    const sourceResponses = getResponsesForSource(domain);
    
    // Only check the company_mentioned field from the database
    const hasMentions = sourceResponses.some(response => {
      return response.company_mentioned === true;
    });
    
    
    return hasMentions;
  };

  const getResponsesForSource = (domain: string) => {
    // Get responses that cite this domain
    const citationResponses = responses.filter(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        return Array.isArray(citations) && citations.some((c: any) => c.domain === domain);
      } catch {
        return false;
      }
    });

    return citationResponses;
  };

  const getFavicon = (domain: string): string => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`;
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
      .slice(0, 20);

    return result;
  }, [groupResponsesByTimePeriod]);

  // Calculate all-time citation data with change indicators
  const allTimeCitations = useMemo(() => {
    // Use the filteredTopCitations instead of topCitations to ensure company-specific data
    const result = filteredTopCitations.map(citation => ({
      name: citation.domain,
      count: citation.count,
      change: 0 // Will be updated after timeBasedCitations is calculated
    }));

    return result;
  }, [filteredTopCitations, topCitations.length, responses.length, searchResults.length, companyName]);

  // Calculate source counts by data type
  const sourceCountsByType = useMemo(() => {
    const counts: Record<string, { ai: number; search: number; total: number }> = {};
    
    // Count AI response citations
    responses.forEach(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        if (Array.isArray(citations)) {
          citations.forEach((citation: any) => {
            if (citation.domain) {
              if (!counts[citation.domain]) {
                counts[citation.domain] = { ai: 0, search: 0, total: 0 };
              }
              counts[citation.domain].ai += 1;
              counts[citation.domain].total += 1;
            }
          });
        }
      } catch {
        // Ignore parsing errors
      }
    });
    
    // Count search result citations
    searchResults.forEach(result => {
      if (result.domain) {
        if (!counts[result.domain]) {
          counts[result.domain] = { ai: 0, search: 0, total: 0 };
        }
        counts[result.domain].search += (result.mentionCount || 1);
        counts[result.domain].total += (result.mentionCount || 1);
      }
    });
    
    return counts;
  }, [responses, searchResults]);

  // Get sources to display based on showAllSources state, media type filter, and source type filter
  const displayedSources = useMemo(() => {
    let sources = allTimeCitations;
    
    // Apply source type filter and adjust counts
    if (selectedSourceTypeFilter !== 'all') {
      sources = sources.filter(citation => {
        if (selectedSourceTypeFilter === 'ai-responses') {
          return isDomainFromAIResponses(citation.name);
        } else if (selectedSourceTypeFilter === 'search-results') {
          return isDomainFromSearchResults(citation.name);
        }
        return true;
      }).map(citation => {
        // Adjust count based on selected source type
        const counts = sourceCountsByType[citation.name];
        if (counts) {
          if (selectedSourceTypeFilter === 'ai-responses') {
            return { ...citation, count: counts.ai };
          } else if (selectedSourceTypeFilter === 'search-results') {
            return { ...citation, count: counts.search };
          }
        }
        return citation;
      });
    }
    
    // Apply media type filter if selected
    if (selectedMediaTypeFilter) {
      sources = sources.filter(citation => {
        const sourceResponses = getResponsesForSource(citation.name);
        const mediaType = getEffectiveMediaType(citation.name, sourceResponses);
        return mediaType === selectedMediaTypeFilter;
      });
    }
    
    // Apply company mentioned filter if selected
    if (selectedCompanyMentionedFilter !== 'all') {
      sources = sources.filter(citation => {
        const hasMentions = hasDomainCompanyMentions(citation.name);
        if (selectedCompanyMentionedFilter === 'mentioned') {
          return hasMentions;
        } else if (selectedCompanyMentionedFilter === 'not-mentioned') {
          return !hasMentions;
        }
        return true;
      });
    }
    
    // Sort by count descending after applying filters
    sources = sources.sort((a, b) => b.count - a.count);
    
    if (showAllSources) {
      return sources;
    }
    // Show first 20 sources
    return sources.slice(0, 20);
  }, [allTimeCitations, showAllSources, selectedMediaTypeFilter, selectedSourceTypeFilter, selectedCompanyMentionedFilter, responses, companyName, searchResults, sourceCountsByType, customMediaTypes]);

  // Merge change data into all-time citations
  const allTimeCitationsWithChanges = useMemo(() => {
    const changeData = new Map();
    timeBasedCitations.forEach(citation => {
      changeData.set(citation.name, citation.change);
    });

    return displayedSources.map(citation => ({
      ...citation,
      change: changeData.get(citation.name) || 0
    }));
  }, [displayedSources, timeBasedCitations]);

  const renderAllTimeBar = (data: { name: string; count: number; change?: number }, maxCount: number) => {
    // Calculate the actual percentage width
    const percentage = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
    
    // Calculate percentage of total citations
    const totalCitations = allTimeCitationsWithChanges.reduce((sum, citation) => sum + citation.count, 0);
    const totalPercentage = totalCitations > 0 ? (data.count / totalCitations) * 100 : 0;
    
    // Truncate labels to 15 characters
    const displayName = getSourceDisplayName(data.name);
    const truncatedName = displayName.length > 15 ? displayName.substring(0, 15) + '...' : displayName;
    
    // Get media type for this source using response data and company name
    const sourceResponses = getResponsesForSource(data.name);
    const mediaType = getEffectiveMediaType(data.name, sourceResponses);
    const mediaTypeInfo = getMediaTypeInfo(mediaType);
    
    return (
      <div className="flex items-center py-3 hover:bg-gray-50/50 transition-colors cursor-pointer rounded-lg px-2 sm:px-3">
        {/* Source name, favicon, and media type badge */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 sm:w-1/3 sm:max-w-[220px]">
          <Favicon domain={data.name} />
          <div className="min-w-0 flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-900 truncate block" title={displayName}>
              {truncatedName}
            </span>
            {editingMediaType === data.name ? (
              <Popover open={true} onOpenChange={(open) => !open && handleMediaTypeCancel()}>
                <PopoverContent 
                  className="w-64 p-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm">Change Media Type</h4>
                    <div className="space-y-2">
                      {Object.entries(MEDIA_TYPE_DESCRIPTIONS).map(([type, description]) => (
                        <button
                          key={type}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMediaTypeSave(data.name, type);
                          }}
                          className="w-full text-left p-2 rounded-md hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs ${getMediaTypeInfo(type).colors}`}>
                              {getMediaTypeInfo(type).label}
                            </Badge>
                            <span className="text-xs text-gray-600">{description}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMediaTypeCancel();
                        }}
                        className="flex-1"
                      >
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      className={`text-xs ${mediaTypeInfo.colors} cursor-pointer hover:opacity-80 transition-opacity`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMediaTypeEdit(data.name);
                      }}
                    >
                      {mediaTypeInfo.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Click to change media type</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
        
        {/* Bar chart - HIDDEN ON MOBILE */}
        <div className="hidden sm:flex flex-1 mx-2 sm:mx-4 bg-gray-200 rounded-full h-4 relative min-w-0 max-w-[120px] sm:max-w-none">
          <div
            className="h-4 rounded-full absolute left-0 top-0"
            style={{ 
              width: `${percentage}%`,
              backgroundColor: '#0DBCBA'
            }}
          />
        </div>
        
        {/* Count and percentage */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center min-w-[35px] sm:min-w-[60px] justify-end">
            <span className="text-sm font-semibold text-gray-900">
              {data.count}
            </span>
          </div>
          <div className="flex items-center min-w-[45px] sm:min-w-[60px] justify-end">
            <span className="text-xs text-gray-500">
              {totalPercentage.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Add source type summary
  const sourceTypeSummary = useMemo(() => {
    const summary = {
      ai: { count: 0, totalCitations: 0 },
      search: { count: 0, totalCitations: 0 },
      both: { count: 0, totalCitations: 0 }
    };
    
    Object.entries(sourceCountsByType).forEach(([domain, counts]) => {
      const isFromSearch = counts.search > 0;
      const isFromAI = counts.ai > 0;
      
      if (isFromSearch && isFromAI) {
        summary.both.count++;
        summary.both.totalCitations += counts.total;
      } else if (isFromSearch) {
        summary.search.count++;
        summary.search.totalCitations += counts.search;
      } else if (isFromAI) {
        summary.ai.count++;
        summary.ai.totalCitations += counts.ai;
      }
    });
    
    return summary;
  }, [sourceCountsByType]);

  // Add company mentioned summary for debugging
  const companyMentionedSummary = useMemo(() => {
    const mentionedDomains = new Set<string>();
    const notMentionedDomains = new Set<string>();
    
    allTimeCitations.forEach(citation => {
      const hasMentions = hasDomainCompanyMentions(citation.name);
      if (hasMentions) {
        mentionedDomains.add(citation.name);
      } else {
        notMentionedDomains.add(citation.name);
      }
    });
    
    
    return {
      mentioned: mentionedDomains.size,
      notMentioned: notMentionedDomains.size,
      total: allTimeCitations.length
    };
  }, [allTimeCitations]);

  // Add media type summary section - always show all media types regardless of filter
  const mediaTypeSummary = useMemo(() => {
    const summary: Record<string, { count: number; totalCitations: number }> = {};
    
    // Use allTimeCitations (unfiltered) to calculate summary, not displayedSources
    allTimeCitations.forEach(citation => {
      const sourceResponses = getResponsesForSource(citation.name);
      const mediaType = getEffectiveMediaType(citation.name, sourceResponses);
      if (!summary[mediaType]) {
        summary[mediaType] = { count: 0, totalCitations: 0 };
      }
      summary[mediaType].count++;
      summary[mediaType].totalCitations += citation.count;
    });
    
    return summary;
  }, [allTimeCitations, responses, companyName, customMediaTypes]);

  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Sources</h2>
        <p className="text-gray-600">
          Discover where {companyName} is mentioned across the web and analyze source performance over time.
        </p>
      </div>

      {/* Sticky Header with Filters */}
      {isPro && (
        <div className="hidden sm:block sticky top-0 z-10 bg-white pb-2">
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Source Type Filter Dropdown */}
            <Select
              value={selectedSourceTypeFilter}
              onValueChange={handleSourceTypeDropdownChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <span>All Sources</span>
                    <span className="text-xs text-gray-500">({sourceTypeSummary.ai.count + sourceTypeSummary.search.count + sourceTypeSummary.both.count})</span>
                  </div>
                </SelectItem>
                <SelectItem value="ai-responses">
                  <div className="flex items-center gap-2">
                    <span>AI Responses</span>
                    <span className="text-xs text-gray-500">({sourceTypeSummary.ai.count + sourceTypeSummary.both.count})</span>
                  </div>
                </SelectItem>
                <SelectItem value="search-results">
                  <div className="flex items-center gap-2">
                    <span>Search Results</span>
                    <span className="text-xs text-gray-500">({sourceTypeSummary.search.count + sourceTypeSummary.both.count})</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            {/* Media Type Filter Dropdown */}
            <Select
              value={selectedMediaTypeFilter || 'all'}
              onValueChange={handleMediaTypeDropdownChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Media Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Media Types</SelectItem>
                {Object.entries(mediaTypeSummary).map(([mediaType, data]) => {
                  const mediaTypeInfo = getMediaTypeInfo(mediaType);
                  return (
                    <SelectItem key={mediaType} value={mediaType}>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${mediaTypeInfo.colors} pointer-events-none`}>
                          {mediaTypeInfo.label}
                        </Badge>
                        <span className="text-xs text-gray-500">({data.count})</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {/* Company Mentioned Filter Dropdown */}
            <Select
              value={selectedCompanyMentionedFilter}
              onValueChange={handleCompanyMentionedDropdownChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Company Mentioned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <span>All Mentions</span>
                    <span className="text-xs text-gray-500">({companyMentionedSummary.total})</span>
                  </div>
                </SelectItem>
                <SelectItem value="mentioned">
                  <div className="flex items-center gap-2">
                    <span>Company Mentioned</span>
                    <span className="text-xs text-gray-500">({companyMentionedSummary.mentioned})</span>
                  </div>
                </SelectItem>
                <SelectItem value="not-mentioned">
                  <div className="flex items-center gap-2">
                    <span>Not Mentioned</span>
                    <span className="text-xs text-gray-500">({companyMentionedSummary.notMentioned})</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Main Content with Tabs */}
      <div className="flex-1 min-h-0">
        <Card className="shadow-sm border border-gray-200 h-full flex flex-col">
          <CardContent className="flex-1 min-h-0 overflow-hidden p-3 sm:p-6">
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
          companyName={companyName}
          searchResults={searchResults}
          companyId={currentCompanyId}
        />
      )}
    </div>
  );
}; 