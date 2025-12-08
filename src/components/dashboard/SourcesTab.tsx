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
import { usePersistedState } from "@/hooks/usePersistedState";
import { extractSourceUrl, extractDomain, enhanceCitations } from "@/utils/citationUtils";

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

// Helper function to normalize domains for consistent counting
const normalizeDomain = (domain: string): string => {
  if (!domain) return '';
  return domain.trim().toLowerCase().replace(/^www\./, '');
};

export const SourcesTab = ({ topCitations, responses, parseCitations, companyName, searchResults = [], currentCompanyId }: SourcesTabProps) => {
  const { isPro } = useSubscription();
  
  // Filter responses and searchResults by currentCompanyId to ensure we only show sources for the current company
  const filteredResponses = useMemo(() => {
    if (!currentCompanyId) return responses;
    return responses.filter(response => response.company_id === currentCompanyId);
  }, [responses, currentCompanyId]);

  const filteredSearchResults = useMemo(() => {
    if (!currentCompanyId) return searchResults;
    return searchResults.filter(result => result.company_id === currentCompanyId);
  }, [searchResults, currentCompanyId]);
  
  // Calculate citation counts from search results
  const searchResultCitations = useMemo(() => {
    const citationCounts: Record<string, number> = {};
    
    filteredSearchResults.forEach(result => {
      if (result.domain) {
        const normalizedDomain = normalizeDomain(result.domain);
        if (normalizedDomain) {
          citationCounts[normalizedDomain] = (citationCounts[normalizedDomain] || 0) + (result.mentionCount || 1);
        }
      }
    });
    
    return Object.entries(citationCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredSearchResults]);
  
  // Modal states - persisted
  const [selectedSource, setSelectedSource] = usePersistedState<CitationCount | null>('sourcesTab.selectedSource', null);
  const [isSourceModalOpen, setIsSourceModalOpen] = usePersistedState<boolean>('sourcesTab.isSourceModalOpen', false);
  const [showAllSources] = useState(true);
  // Filter states - persisted
  const [selectedMediaTypeFilter, setSelectedMediaTypeFilter] = usePersistedState<string | null>('sourcesTab.selectedMediaTypeFilter', null);
  const [selectedSourceTypeFilter, setSelectedSourceTypeFilter] = usePersistedState<'all' | 'ai-responses' | 'search-results'>('sourcesTab.selectedSourceTypeFilter', 'all');
  const [selectedCompanyMentionedFilter, setSelectedCompanyMentionedFilter] = usePersistedState<'all' | 'mentioned' | 'not-mentioned'>('sourcesTab.selectedCompanyMentionedFilter', 'all');
  const [selectedJobFunctionFilter, setSelectedJobFunctionFilter] = usePersistedState<string>('sourcesTab.selectedJobFunctionFilter', 'all');
  const [selectedThemeFilter, setSelectedThemeFilter] = usePersistedState<string>('sourcesTab.selectedThemeFilter', 'all');
  
  // Media type editing state
  const [editingMediaType, setEditingMediaType] = useState<string | null>(null);
  const [customMediaTypes, setCustomMediaTypes] = useState<Record<string, string>>({});

  // Get all available themes/attributes from responses
  const availableThemes = useMemo(() => {
    const themes = new Set<string>();
    filteredResponses.forEach(r => {
      const theme = r.confirmed_prompts?.prompt_theme;
      if (theme && theme.trim()) {
        themes.add(theme);
      }
    });
    
    // Sort themes alphabetically, but put "General" first if it exists
    const sortedThemes = Array.from(themes).sort((a, b) => {
      if (a === 'General') return -1;
      if (b === 'General') return 1;
      return a.localeCompare(b);
    });
    
    return sortedThemes;
  }, [filteredResponses]);

  // Helper to get filtered responses based on all filters (job function, theme)
  const getFilteredResponsesByAllFilters = useMemo(() => {
    let filtered = filteredResponses;
    
    // Filter by job function
    if (selectedJobFunctionFilter !== 'all') {
      filtered = filtered.filter(response => {
        const jobFunctionContext = response.confirmed_prompts?.job_function_context?.trim();
        return jobFunctionContext === selectedJobFunctionFilter;
      });
    }
    
    // Filter by theme/attribute
    if (selectedThemeFilter !== 'all') {
      filtered = filtered.filter(response => {
        const theme = response.confirmed_prompts?.prompt_theme;
        return theme === selectedThemeFilter;
      });
    }
    
    return filtered;
  }, [filteredResponses, selectedJobFunctionFilter, selectedThemeFilter]);

  // Helper to get filtered responses based on job function filter (kept for backward compatibility)
  const getFilteredResponsesByJobFunction = useMemo(() => {
    return getFilteredResponsesByAllFilters;
  }, [getFilteredResponsesByAllFilters]);

  // Calculate citation counts directly from prompt_responses for AI responses
  // Use enhanceCitations to match the same logic as topCitations calculation
  const aiResponseCitations = useMemo(() => {
    const citationCounts: Record<string, number> = {};
    
    getFilteredResponsesByJobFunction.forEach(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        
        if (Array.isArray(citations)) {
          // Use enhanceCitations to properly extract domains (same as topCitations)
          const enhancedCitations = enhanceCitations(citations);
          enhancedCitations.forEach((enhancedCitation) => {
            // Only count website citations (same as topCitations logic)
            if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
              const normalizedDomain = normalizeDomain(enhancedCitation.domain);
              if (normalizedDomain) {
                citationCounts[normalizedDomain] = (citationCounts[normalizedDomain] || 0) + 1;
              }
            }
          });
        }
      } catch {
        // Ignore parsing errors
      }
    });
    
    return Object.entries(citationCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [getFilteredResponsesByJobFunction]);

  // Combine both sources for "all" view
  const allSourcesCitations = useMemo(() => {
    const combinedCounts: Record<string, number> = {};
    
    // Add AI response citations
    aiResponseCitations.forEach(({ domain, count }) => {
      combinedCounts[domain] = (combinedCounts[domain] || 0) + count;
    });
    
    // Add search result citations
    searchResultCitations.forEach(({ domain, count }) => {
      combinedCounts[domain] = (combinedCounts[domain] || 0) + count;
    });
    
    return Object.entries(combinedCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [aiResponseCitations, searchResultCitations]);

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

  const handleJobFunctionFilterChange = (value: string) => {
    setSelectedJobFunctionFilter(value);
  };

  const handleThemeFilterChange = (value: string) => {
    setSelectedThemeFilter(value);
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
    const normalizedDomain = normalizeDomain(domain);
    return filteredSearchResults.some(result => normalizeDomain(result.domain) === normalizedDomain);
  };

  // Helper function to check if a domain comes from AI responses
  const isDomainFromAIResponses = (domain: string) => {
    const normalizedDomain = normalizeDomain(domain);
    return filteredResponses.some(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        if (Array.isArray(citations)) {
          // Use enhanceCitations to properly extract domains
          const enhancedCitations = enhanceCitations(citations);
          return enhancedCitations.some((enhancedCitation) => {
            return enhancedCitation.type === 'website' && 
                   enhancedCitation.domain && 
                   normalizeDomain(enhancedCitation.domain) === normalizedDomain;
          });
        }
        return false;
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

  // Helper function to check if a source comes from a specific job function context
  const isSourceFromJobFunction = (domain: string, jobFunction: string) => {
    const normalizedDomain = normalizeDomain(domain);
    return filteredResponses.some(response => {
      const jobFunctionContext = response.confirmed_prompts?.job_function_context?.trim();
      if (jobFunctionContext !== jobFunction) return false;
      
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        if (Array.isArray(citations)) {
          // Use enhanceCitations to properly extract domains
          const enhancedCitations = enhanceCitations(citations);
          return enhancedCitations.some((enhancedCitation) => {
            return enhancedCitation.type === 'website' && 
                   enhancedCitation.domain && 
                   normalizeDomain(enhancedCitation.domain) === normalizedDomain;
          });
        }
        return false;
      } catch {
        return false;
      }
    });
  };

  const getResponsesForSource = (domain: string) => {
    // Get responses that cite this domain (normalized)
    const normalizedDomain = normalizeDomain(domain);
    const citationResponses = getFilteredResponsesByJobFunction.filter(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        if (Array.isArray(citations)) {
          // Use enhanceCitations to properly extract domains
          const enhancedCitations = enhanceCitations(citations);
          return enhancedCitations.some((enhancedCitation) => {
            return enhancedCitation.type === 'website' && 
                   enhancedCitation.domain && 
                   normalizeDomain(enhancedCitation.domain) === normalizedDomain;
          });
        }
        return false;
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
    // Use filtered responses that respect all filters (category, theme, job function)
    const responsesToUse = getFilteredResponsesByAllFilters;
    if (responsesToUse.length === 0) return { current: [], previous: [] };

    // Sort responses by tested_at descending
    const sortedResponses = [...responsesToUse].sort((a, b) => 
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
  }, [getFilteredResponsesByAllFilters]);

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
      // Use enhanceCitations to properly extract domains (same as topCitations)
      const enhancedCitations = enhanceCitations(citations);
      enhancedCitations.forEach((enhancedCitation) => {
        // Only count website citations (same as topCitations logic)
        if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
          const normalizedDomain = normalizeDomain(enhancedCitation.domain);
          if (normalizedDomain) {
            currentCitations[normalizedDomain] = (currentCitations[normalizedDomain] || 0) + 1;
          }
        }
      });
    });

    // Get citation counts for previous period and calculate average
    const previousCitations: Record<string, number> = {};
    const previousUniqueDays = new Set(previous.map(r => new Date(r.tested_at).toDateString()));
    const numPreviousDays = Math.max(1, previousUniqueDays.size);

    previous.forEach(response => {
      const citations = parseCitations(response.citations);
      // Use enhanceCitations to properly extract domains (same as topCitations)
      const enhancedCitations = enhanceCitations(citations);
      enhancedCitations.forEach((enhancedCitation) => {
        // Only count website citations (same as topCitations logic)
        if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
          const normalizedDomain = normalizeDomain(enhancedCitation.domain);
          if (normalizedDomain) {
            previousCitations[normalizedDomain] = (previousCitations[normalizedDomain] || 0) + 1;
          }
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

  // Get the appropriate citation source based on filter, with company_mentioned filtering applied
  const allTimeCitations = useMemo(() => {
    let sourceCitations;
    
    // If company mentioned filter is active and not on search-results, recalculate counts from filtered responses
    if (selectedCompanyMentionedFilter !== 'all' && selectedSourceTypeFilter !== 'search-results') {
      const filteredCounts: Record<string, number> = {};
      
      // Recalculate counts from responses based on company_mentioned filter
      getFilteredResponsesByJobFunction.forEach(response => {
        // Check if this response matches the company_mentioned filter
        const matchesFilter = selectedCompanyMentionedFilter === 'mentioned' 
          ? response.company_mentioned === true 
          : response.company_mentioned === false || response.company_mentioned == null;
        
        if (!matchesFilter) return;
        
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          
          if (Array.isArray(citations)) {
            // Use enhanceCitations to properly extract domains (same as topCitations)
            const enhancedCitations = enhanceCitations(citations);
            enhancedCitations.forEach((enhancedCitation) => {
              // Only count website citations (same as topCitations logic)
              if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
                const normalizedDomain = normalizeDomain(enhancedCitation.domain);
                if (normalizedDomain) {
                  filteredCounts[normalizedDomain] = (filteredCounts[normalizedDomain] || 0) + 1;
                }
              }
            });
          }
        } catch {
          // Ignore parsing errors
        }
      });
      
      // If source type filter is 'all' and company mentioned filter is 'not-mentioned', 
      // also include search results (they don't have company_mentioned field, so treat as not-mentioned)
      if (selectedSourceTypeFilter === 'all' && selectedCompanyMentionedFilter === 'not-mentioned') {
        filteredSearchResults.forEach(result => {
          if (result.domain) {
            const normalizedDomain = normalizeDomain(result.domain);
            if (normalizedDomain) {
              filteredCounts[normalizedDomain] = (filteredCounts[normalizedDomain] || 0) + (result.mentionCount || 1);
            }
          }
        });
      }
      
      // Convert to array format, only including sources with counts > 0
      // This ensures that when filtering by "company IS mentioned", we only show sources
      // that actually have citations from responses where company_mentioned = true
      sourceCitations = Object.entries(filteredCounts)
        .filter(([_, count]) => count > 0) // Only include sources with counts > 0
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count);
    } else {
      // No company mentioned filter, use the standard citation sources
      // When theme filter is active, exclude search results from "all" view
      // since they don't have theme information
      const hasThemeFilter = selectedThemeFilter !== 'all';
      
      if (selectedSourceTypeFilter === 'ai-responses') {
        sourceCitations = aiResponseCitations;
      } else if (selectedSourceTypeFilter === 'search-results') {
        sourceCitations = searchResultCitations;
      } else if (hasThemeFilter) {
        // When filtering by theme, only show AI response citations
        // (search results don't have theme data)
        sourceCitations = aiResponseCitations;
      } else {
        sourceCitations = allSourcesCitations;
      }
    }
    
    return sourceCitations.map(citation => ({
      name: citation.domain,
      count: citation.count,
      change: 0 // Will be updated after timeBasedCitations is calculated
    }));
  }, [aiResponseCitations, searchResultCitations, allSourcesCitations, selectedSourceTypeFilter, selectedCompanyMentionedFilter, selectedThemeFilter, getFilteredResponsesByJobFunction, filteredSearchResults]);

  // Calculate source counts by data type
  const sourceCountsByType = useMemo(() => {
    const counts: Record<string, { ai: number; search: number; total: number }> = {};
    
    // Count AI response citations
    filteredResponses.forEach(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        if (Array.isArray(citations)) {
          // Use enhanceCitations to properly extract domains (same as topCitations)
          const enhancedCitations = enhanceCitations(citations);
          enhancedCitations.forEach((enhancedCitation) => {
            // Only count website citations (same as topCitations logic)
            if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
              const normalizedDomain = normalizeDomain(enhancedCitation.domain);
              if (normalizedDomain) {
                if (!counts[normalizedDomain]) {
                  counts[normalizedDomain] = { ai: 0, search: 0, total: 0 };
                }
                counts[normalizedDomain].ai += 1;
                counts[normalizedDomain].total += 1;
              }
            }
          });
        }
      } catch {
        // Ignore parsing errors
      }
    });
    
    // Count search result citations
    filteredSearchResults.forEach(result => {
      if (result.domain) {
        const normalizedDomain = normalizeDomain(result.domain);
        if (normalizedDomain) {
          if (!counts[normalizedDomain]) {
            counts[normalizedDomain] = { ai: 0, search: 0, total: 0 };
          }
          counts[normalizedDomain].search += (result.mentionCount || 1);
          counts[normalizedDomain].total += (result.mentionCount || 1);
        }
      }
    });
    
    return counts;
  }, [filteredResponses, filteredSearchResults]);


  // Get sources to display based on showAllSources state, media type filter, and company mentioned filter
  // When filters are applied, we need to recalculate counts to ensure percentages are correct
  const displayedSources = useMemo(() => {
    let sources = allTimeCitations;
    
    // Apply media type filter if selected
    if (selectedMediaTypeFilter) {
      sources = sources.filter(citation => {
        const sourceResponses = getResponsesForSource(citation.name);
        const mediaType = getEffectiveMediaType(citation.name, sourceResponses);
        return mediaType === selectedMediaTypeFilter;
      });
    }
    
    // If company mentioned filter is active AND media type filter is also applied,
    // we need to recalculate counts because media type filtering might have changed which sources are shown
    if (selectedCompanyMentionedFilter !== 'all' && selectedSourceTypeFilter !== 'search-results' && selectedMediaTypeFilter) {
      // Recalculate counts for the filtered sources to ensure accuracy
      const recalculatedCounts: Record<string, number> = {};
      const filteredSourceDomains = new Set(sources.map(s => normalizeDomain(s.name)));
      
      getFilteredResponsesByJobFunction.forEach(response => {
        // Check if this response matches the company_mentioned filter
        const matchesFilter = selectedCompanyMentionedFilter === 'mentioned' 
          ? response.company_mentioned === true 
          : response.company_mentioned === false || response.company_mentioned == null;
        
        if (!matchesFilter) return;
        
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          
          if (Array.isArray(citations)) {
            // Use enhanceCitations to properly extract domains (same as topCitations)
            const enhancedCitations = enhanceCitations(citations);
            enhancedCitations.forEach((enhancedCitation) => {
              // Only count website citations (same as topCitations logic)
              if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
                const normalizedDomain = normalizeDomain(enhancedCitation.domain);
                if (normalizedDomain && filteredSourceDomains.has(normalizedDomain)) {
                  recalculatedCounts[normalizedDomain] = (recalculatedCounts[normalizedDomain] || 0) + 1;
                }
              }
            });
          }
        } catch {
          // Ignore parsing errors
        }
      });
      
      // Update source counts with recalculated values
      sources = sources.map(source => {
        const normalizedName = normalizeDomain(source.name);
        const newCount = recalculatedCounts[normalizedName] || 0;
        return {
          ...source,
          count: newCount
        };
      }).filter(source => source.count > 0); // Remove sources with 0 counts
    }
    
    // Filter by job function - only show sources from the selected job function
    if (selectedJobFunctionFilter !== 'all') {
      sources = sources.filter(source => 
        source.count > 0 && isSourceFromJobFunction(source.name, selectedJobFunctionFilter)
      );
    }
    
    // Filter out any sources with 0 counts (shouldn't happen, but safety check)
    sources = sources.filter(source => source.count > 0);
    
    // Sort by count descending after applying filters
    sources = sources.sort((a, b) => b.count - a.count);
    
    if (showAllSources) {
      return sources;
    }
    // Show first 20 sources
    return sources.slice(0, 20);
  }, [allTimeCitations, showAllSources, selectedMediaTypeFilter, selectedSourceTypeFilter, selectedCompanyMentionedFilter, selectedJobFunctionFilter, filteredResponses, companyName, customMediaTypes]);

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

  const renderAllTimeBar = (data: { name: string; count: number; change?: number }, maxCount: number, totalCitations: number) => {
    // Calculate the actual percentage width
    const percentage = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
    
    // Calculate percentage of total citations in the CURRENT filtered dataset
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
    const aiDomains = new Set(aiResponseCitations.map(c => c.domain));
    const searchDomains = new Set(searchResultCitations.map(c => c.domain));
    
    const summary = {
      ai: { count: 0, totalCitations: 0 },
      search: { count: 0, totalCitations: 0 },
      both: { count: 0, totalCitations: 0 }
    };
    
    // Count AI-only sources
    aiResponseCitations.forEach(citation => {
      if (!searchDomains.has(citation.domain)) {
        summary.ai.count++;
        summary.ai.totalCitations += citation.count;
      }
    });
    
    // Count search-only sources
    searchResultCitations.forEach(citation => {
      if (!aiDomains.has(citation.domain)) {
        summary.search.count++;
        summary.search.totalCitations += citation.count;
      }
    });
    
    // Count sources in both
    aiResponseCitations.forEach(citation => {
      if (searchDomains.has(citation.domain)) {
        summary.both.count++;
        const aiCount = citation.count;
        const searchCitation = searchResultCitations.find(c => c.domain === citation.domain);
        const searchCount = searchCitation?.count || 0;
        summary.both.totalCitations += aiCount + searchCount;
      }
    });
    
    return summary;
  }, [aiResponseCitations, searchResultCitations]);

  // Add company mentioned summary (only relevant for AI responses)
  const companyMentionedSummary = useMemo(() => {
    if (selectedSourceTypeFilter === 'search-results') {
      // Company mentioned filter doesn't apply to search results
      return {
        mentioned: 0,
        notMentioned: 0,
        total: 0
      };
    }
    
    const mentionedDomains = new Set<string>();
    const notMentionedDomains = new Set<string>();
    
    // Count domains based on responses
    filteredResponses.forEach(response => {
      try {
        const citations = typeof response.citations === 'string' 
          ? JSON.parse(response.citations) 
          : response.citations;
        
        if (Array.isArray(citations)) {
          // Use enhanceCitations to properly extract domains (same as topCitations)
          const enhancedCitations = enhanceCitations(citations);
          enhancedCitations.forEach((enhancedCitation) => {
            // Only count website citations (same as topCitations logic)
            if (enhancedCitation.type === 'website' && enhancedCitation.domain) {
              const normalizedDomain = normalizeDomain(enhancedCitation.domain);
              if (normalizedDomain) {
                if (response.company_mentioned === true) {
                  mentionedDomains.add(normalizedDomain);
                } else {
                  notMentionedDomains.add(normalizedDomain);
                }
              }
            }
          });
        }
      } catch {
        // Ignore parsing errors
      }
    });
    
    // A domain could appear in both sets if it has mixed mentions
    // For the summary, we want unique domains in each category
    const totalUniqueDomains = new Set([...mentionedDomains, ...notMentionedDomains]);
    
    return {
      mentioned: mentionedDomains.size,
      notMentioned: notMentionedDomains.size,
      total: totalUniqueDomains.size
    };
  }, [selectedSourceTypeFilter, filteredResponses]);

  // Add media type summary section - calculated based on current source filter
  const mediaTypeSummary = useMemo(() => {
    const summary: Record<string, { count: number; totalCitations: number }> = {};
    
    // Use the appropriate source based on filter
    const sourcesToAnalyze = selectedSourceTypeFilter === 'ai-responses' 
      ? aiResponseCitations 
      : selectedSourceTypeFilter === 'search-results'
      ? searchResultCitations
      : allSourcesCitations;
    
    sourcesToAnalyze.forEach(citation => {
      const sourceResponses = getResponsesForSource(citation.domain);
      const mediaType = getEffectiveMediaType(citation.domain, sourceResponses);
      if (!summary[mediaType]) {
        summary[mediaType] = { count: 0, totalCitations: 0 };
      }
      summary[mediaType].count++;
      summary[mediaType].totalCitations += citation.count;
    });
    
    return summary;
  }, [selectedSourceTypeFilter, aiResponseCitations, searchResultCitations, allSourcesCitations, filteredResponses, companyName, customMediaTypes]);

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
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
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
            {/* Job Function Filter Dropdown */}
            <Select
              value={selectedJobFunctionFilter}
              onValueChange={handleJobFunctionFilterChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Job Functions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <span>All Job Functions</span>
                    <span className="text-xs text-gray-500">({allSourcesCitations.length})</span>
                  </div>
                </SelectItem>
                {getUniqueJobFunctions.map(jobFunction => (
                  <SelectItem key={jobFunction} value={jobFunction}>
                    <div className="flex items-center gap-2">
                      <span>{jobFunction}</span>
                      <span className="text-xs text-gray-500">({allSourcesCitations.filter(c => isSourceFromJobFunction(c.domain, jobFunction)).length})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Theme/Attribute Filter Dropdown */}
            {availableThemes.length > 0 && (
              <Select
                value={selectedThemeFilter}
                onValueChange={handleThemeFilterChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All Attributes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <div className="flex items-center gap-2">
                      <span>All Attributes</span>
                      <span className="text-xs text-gray-500">({allSourcesCitations.length})</span>
                    </div>
                  </SelectItem>
                  {availableThemes.map(theme => (
                    <SelectItem key={theme} value={theme}>
                      {theme}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
                  // Calculate total citations from the CURRENT filtered dataset
                  // This ensures percentages add up to 100% for the active filters
                  const totalCitations = allTimeCitationsWithChanges.reduce((sum, citation) => sum + citation.count, 0);
                  return allTimeCitationsWithChanges.map((citation, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleSourceClick({ domain: citation.name, count: citation.count })}
                      className="cursor-pointer"
                    >
                      {renderAllTimeBar(citation, maxCount, totalCitations)}
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
          searchResults={filteredSearchResults}
          companyId={currentCompanyId}
          selectedThemeFilter={selectedThemeFilter}
        />
      )}
    </div>
  );
}; 