import { useState, useMemo, useEffect, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CitationCount } from "@/types/dashboard";
import { FileText, TrendingUp, TrendingDown, Check, X } from 'lucide-react';
import { SourceDetailsModal } from "./SourceDetailsModal";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Favicon } from "@/components/ui/favicon";
import { categorizeSourceByMediaType, getMediaTypeInfo, MEDIA_TYPE_DESCRIPTIONS } from "@/utils/sourceConfig";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  responseTexts?: Record<string, string>;
  fetchResponseTexts?: (ids: string[]) => Promise<Record<string, string>>;
  previousPeriodResponses?: any[];
}

// Helper function to normalize domains for consistent counting
const normalizeDomain = (domain: string): string => {
  if (!domain) return '';
  return domain.trim().toLowerCase().replace(/^www\./, '');
};

export const SourcesTab = memo(({ topCitations, responses, parseCitations, companyName, searchResults = [], currentCompanyId, responseTexts = {}, fetchResponseTexts, previousPeriodResponses = [] }: SourcesTabProps) => {
  
  // Filter responses and searchResults by currentCompanyId to ensure we only show sources for the current company
  const filteredResponses = useMemo(() => {
    if (!currentCompanyId) return responses;
    return responses.filter(response => response.company_id === currentCompanyId);
  }, [responses, currentCompanyId]);

  const filteredSearchResults = useMemo(() => {
    if (!currentCompanyId) return searchResults;
    return searchResults.filter(result => result.company_id === currentCompanyId);
  }, [searchResults, currentCompanyId]);

  // -----------------------------------------------------------------------
  // SINGLE-PASS CITATION NORMALIZATION
  //
  // For orgs like Netflix (~38K responses × ~6 citations each), the prior
  // implementation invoked JSON.parse + enhanceCitations in 8+ separate memos
  // and helper functions. That work lives on the main thread and was the
  // primary reason SourcesTab froze the browser on open.
  //
  // We do the parse ONCE here and hand every downstream consumer a cheap
  // precomputed shape. All downstream memos read `normalizedResponses` and
  // `responsesByDomain` instead of parsing citations again.
  // -----------------------------------------------------------------------
  type NormalizedResponse = {
    raw: any;
    id: string;
    company_mentioned: boolean;
    promptType: string | undefined;
    theme: string | undefined;
    jobFunction: string | null;
    // Normalized, deduplicated website domains cited by this response.
    domains: string[];
  };

  const normalizeResponsesOnce = (input: any[]): NormalizedResponse[] => {
    return input.map((r) => {
      let parsed: any = r.citations;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      const arr = Array.isArray(parsed) ? enhanceCitations(parsed) : [];
      const seen = new Set<string>();
      const domains: string[] = [];
      for (const c of arr) {
        if (c.type === 'website' && c.domain) {
          const d = normalizeDomain(c.domain);
          if (d && !seen.has(d)) {
            seen.add(d);
            domains.push(d);
          }
        }
      }
      return {
        raw: r,
        id: r.id,
        company_mentioned: r.company_mentioned === true,
        promptType: r.confirmed_prompts?.prompt_type,
        theme: r.confirmed_prompts?.prompt_theme,
        jobFunction: r.confirmed_prompts?.job_function_context?.trim() || null,
        domains,
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

  // Reverse index: domain → responses that cite it. Used by
  // getResponsesForSource / isDomainFromAIResponses / isSourceFromJobFunction
  // which previously re-parsed all responses for every source click/render.
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
  // Render cap: each row creates Favicon + Badge + Popover + Tooltip. With
  // 500+ source domains that's thousands of DOM nodes on mount and the tab
  // feels frozen. Show top N by default, let the user opt in to the full list.
  const INITIAL_RENDER_LIMIT = 100;
  const [showAllSources, setShowAllSources] = useState(false);
  // Mentioned/Not Mentioned toggle - persisted
  const [selectedCompanyMentionedFilter, setSelectedCompanyMentionedFilter] = usePersistedState<'mentioned' | 'not-mentioned'>('sourcesTab.selectedCompanyMentionedFilter', 'mentioned');
  // Other filters hardcoded to defaults (dropdowns removed).
  //
  // Typed as the full union rather than narrowed-to-literal so the
  // "filter active" branches downstream stay valid even though the current
  // constant value never activates them. If these dropdowns get re-enabled,
  // they can be promoted back to useState without any caller changes.
  const selectedMediaTypeFilter: string | null = null;
  const selectedSourceTypeFilter = 'all' as 'all' | 'ai-responses' | 'search-results';
  const selectedJobFunctionFilter = 'all' as string;
  const selectedThemeFilter = 'all' as string;
  const selectedPromptTypeFilter = 'all' as string;

  // `selectedCompanyMentionedFilter` is persisted state above; widen below via
  // comparison sites where we need to handle a legacy 'all' branch.
  
  // Media type editing state
  const [editingMediaType, setEditingMediaType] = useState<string | null>(null);
  const [customMediaTypes, setCustomMediaTypes] = useState<Record<string, string>>({});

  // Get all available prompt types from responses
  const availablePromptTypes = useMemo(() => {
    const promptTypes = new Set<string>();
    filteredResponses.forEach(r => {
      const promptType = r.confirmed_prompts?.prompt_type;
      if (promptType) {
        // Normalize to base types (remove talentx_ prefix)
        const baseType = promptType.replace('talentx_', '');
        if (['experience', 'competitive', 'discovery', 'informational'].includes(baseType)) {
          promptTypes.add(baseType);
        }
      }
    });
    return Array.from(promptTypes).sort();
  }, [filteredResponses]);

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

  // Helper to get filtered responses based on all filters (job function, theme, prompt_type)
  const getFilteredResponsesByAllFilters = useMemo(() => {
    let filtered = filteredResponses;
    
    // Filter by prompt_type
    if (selectedPromptTypeFilter !== 'all') {
      filtered = filtered.filter(response => {
        const promptType = response.confirmed_prompts?.prompt_type;
        // Handle both regular and talentx_ variants
        if (selectedPromptTypeFilter === 'experience') {
          return promptType === 'experience' || promptType === 'talentx_experience';
        } else if (selectedPromptTypeFilter === 'competitive') {
          return promptType === 'competitive' || promptType === 'talentx_competitive';
        } else if (selectedPromptTypeFilter === 'discovery') {
          return promptType === 'discovery' || promptType === 'talentx_discovery';
        } else if (selectedPromptTypeFilter === 'informational') {
          return promptType === 'informational' || promptType === 'talentx_informational';
        }
        return false;
      });
    }
    
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
  }, [filteredResponses, selectedPromptTypeFilter, selectedJobFunctionFilter, selectedThemeFilter]);

  // Helper to get filtered responses based on job function filter (kept for backward compatibility)
  const getFilteredResponsesByJobFunction = useMemo(() => {
    return getFilteredResponsesByAllFilters;
  }, [getFilteredResponsesByAllFilters]);

  // Citation counts from AI responses — reads pre-parsed normalizedResponses.
  // getFilteredResponsesByJobFunction returns filteredResponses verbatim when
  // the filter dropdowns are at default 'all' (current UI), so we index by
  // normalizedResponses (same underlying data). If the filters are ever
  // re-enabled this should be restructured to filter normalizedResponses.
  const aiResponseCitations = useMemo(() => {
    const citationCounts: Record<string, number> = {};
    for (const nr of normalizedResponses) {
      for (const d of nr.domains) {
        citationCounts[d] = (citationCounts[d] || 0) + 1;
      }
    }
    return Object.entries(citationCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [normalizedResponses]);

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

  // Clear persisted "unknown" source so we never open the modal with unknown (domains are now derived from URLs).
  // Note: CitationCount's identifying field is `domain`, not `name` — the earlier
  // implementation referenced `.name` which was silently undefined and never
  // triggered the cleanup.
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

  const handleCloseSourceModal = () => {
    setIsSourceModalOpen(false);
    setSelectedSource(null);
  };

  const handleMediaTypeClick = (_mediaType: string) => {
    // Media type filtering is disabled — the dropdown was removed and
    // selectedMediaTypeFilter is a constant `null`. This handler is kept only
    // because it's still wired up in the JSX; when filtering gets re-enabled,
    // reintroduce the useState<string | null>(null) and restore the toggle
    // logic here.
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

  // Helper function to check if a domain comes from AI responses. O(1) via
  // the precomputed responsesByDomain index instead of re-parsing everything.
  const isDomainFromAIResponses = (domain: string) => {
    return responsesByDomain.has(normalizeDomain(domain));
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

  // Helper function to check if a source comes from a specific job function context.
  // Uses the precomputed domain → responses index + a quick jobFunction scan
  // instead of re-parsing every response's citations.
  const isSourceFromJobFunction = (domain: string, jobFunction: string) => {
    const list = responsesByDomain.get(normalizeDomain(domain));
    if (!list) return false;
    for (const nr of list) {
      if (nr.jobFunction === jobFunction) return true;
    }
    return false;
  };

  const getResponsesForSource = (domain: string) => {
    // Return the raw response rows that cite this domain. The underlying
    // data is already keyed via responsesByDomain so this is O(1) instead
    // of iterating and re-parsing every response.
    const list = responsesByDomain.get(normalizeDomain(domain));
    return list ? list.map((nr) => nr.raw) : [];
  };

  const getFavicon = (domain: string): string => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`;
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, ""); // Remove www. if present
  };

  // Cross-period citation counts for delta computation. Reads normalized data
  // for both periods — no citation re-parsing.
  const timeBasedCitations = useMemo(() => {
    if (normalizedPrevResponses.length === 0) return [];

    const countFromNormalized = (list: NormalizedResponse[]) => {
      const counts: Record<string, number> = {};
      for (const nr of list) {
        for (const d of nr.domains) {
          counts[d] = (counts[d] || 0) + 1;
        }
      }
      return counts;
    };

    const currentCounts = countFromNormalized(normalizedResponses);
    const prevCounts = countFromNormalized(normalizedPrevResponses);

    const allDomains = new Set([...Object.keys(currentCounts), ...Object.keys(prevCounts)]);

    return Array.from(allDomains).map(domain => ({
      name: domain,
      current: currentCounts[domain] || 0,
      previous: prevCounts[domain] || 0,
      change: (currentCounts[domain] || 0) - (prevCounts[domain] || 0),
      changePercent: 0 // computed at render time using consistent displayed totals
    })).sort((a, b) => b.current - a.current);
  }, [normalizedResponses, normalizedPrevResponses]);

  // Get the appropriate citation source based on filter, with company_mentioned filtering applied
  const allTimeCitations = useMemo(() => {
    let sourceCitations;
    
    // If company mentioned filter is active and not on search-results, recalculate counts from filtered responses
    if ((selectedCompanyMentionedFilter as string) !== 'all' && selectedSourceTypeFilter !== 'search-results') {
      const filteredCounts: Record<string, number> = {};

      // Recalculate from the normalized, pre-parsed responses. No JSON.parse
      // on the hot path.
      for (const nr of normalizedResponses) {
        const matchesFilter = selectedCompanyMentionedFilter === 'mentioned'
          ? nr.company_mentioned === true
          : nr.company_mentioned === false;
        if (!matchesFilter) continue;
        for (const d of nr.domains) {
          filteredCounts[d] = (filteredCounts[d] || 0) + 1;
        }
      }
      
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
  }, [aiResponseCitations, searchResultCitations, allSourcesCitations, selectedSourceTypeFilter, selectedCompanyMentionedFilter, selectedThemeFilter, normalizedResponses, filteredSearchResults]);

  // Calculate source counts by data type. Reads normalized data — no parsing.
  const sourceCountsByType = useMemo(() => {
    const counts: Record<string, { ai: number; search: number; total: number }> = {};

    for (const nr of normalizedResponses) {
      for (const d of nr.domains) {
        if (!counts[d]) counts[d] = { ai: 0, search: 0, total: 0 };
        counts[d].ai += 1;
        counts[d].total += 1;
      }
    }
    
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
  }, [normalizedResponses, filteredSearchResults]);


  // Get sources to display based on showAllSources state, media type filter, and company mentioned filter
  // When filters are applied, we need to recalculate counts to ensure percentages are correct
  const displayedSources = useMemo(() => {
    // Never show "unknown" as a source (e.g. ChatGPT citations without domain are now derived from URL)
    let sources = allTimeCitations.filter(
      citation => citation.name && normalizeDomain(citation.name) !== 'unknown'
    );
    
    // Apply media type filter if selected
    if (selectedMediaTypeFilter) {
      sources = sources.filter(citation => {
        const sourceResponses = getResponsesForSource(citation.name);
        const mediaType = getEffectiveMediaType(citation.name, sourceResponses);
        return mediaType === selectedMediaTypeFilter;
      });
    }
    
    // If company mentioned filter is active AND media type filter is also applied,
    // recalculate counts from normalized data so percentages stay accurate.
    if ((selectedCompanyMentionedFilter as string) !== 'all' && selectedSourceTypeFilter !== 'search-results' && selectedMediaTypeFilter) {
      const recalculatedCounts: Record<string, number> = {};
      const filteredSourceDomains = new Set(sources.map(s => normalizeDomain(s.name)));

      for (const nr of normalizedResponses) {
        const matchesFilter = selectedCompanyMentionedFilter === 'mentioned'
          ? nr.company_mentioned === true
          : nr.company_mentioned === false;
        if (!matchesFilter) continue;
        for (const d of nr.domains) {
          if (filteredSourceDomains.has(d)) {
            recalculatedCounts[d] = (recalculatedCounts[d] || 0) + 1;
          }
        }
      }

      sources = sources.map(source => {
        const normalizedName = normalizeDomain(source.name);
        const newCount = recalculatedCounts[normalizedName] || 0;
        return { ...source, count: newCount };
      }).filter(source => source.count > 0);
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
    
    return sources;
  }, [allTimeCitations, selectedMediaTypeFilter, selectedSourceTypeFilter, selectedCompanyMentionedFilter, selectedJobFunctionFilter, normalizedResponses, companyName, customMediaTypes, responsesByDomain]);

  // Pre-cap count so the "Show all N sources" button can surface the full total
  // even when only INITIAL_RENDER_LIMIT rows are actually rendered.
  const totalSourceCount = displayedSources.length;

  // Merge change data into all-time citations
  const allTimeCitationsWithChanges = useMemo(() => {
    const changeMap = new Map<string, { change: number; previous: number }>();
    timeBasedCitations.forEach(citation => {
      changeMap.set(citation.name, { change: citation.change, previous: citation.previous });
    });

    return displayedSources.map(citation => {
      const prev = changeMap.get(citation.name)?.previous || 0;
      return {
        ...citation,
        change: changeMap.get(citation.name)?.change || 0,
        previousCount: prev,
        hasPreviousData: prev > 0
      };
    });
  }, [displayedSources, timeBasedCitations]);

  const renderAllTimeBar = (data: { name: string; count: number; change?: number; previousCount?: number; hasPreviousData?: boolean }, maxCount: number, totalCitations: number, totalPreviousCitations: number) => {
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
        
        {/* Percentage + change */}
        <div className="flex items-center min-w-[70px] sm:min-w-[100px] justify-end gap-1.5">
          <span className="text-sm font-semibold text-gray-900">
            {totalPercentage.toFixed(1)}%
          </span>
          <span className="w-[45px] flex justify-end">
            {(() => {
              if (!data.hasPreviousData) return null;
              const prevPct = totalPreviousCitations > 0 ? ((data.previousCount || 0) / totalPreviousCitations) * 100 : 0;
              const delta = Math.round(totalPercentage - prevPct);
              if (delta === 0) return <span className="text-xs text-gray-400">-</span>;
              return (
                <span className={`text-xs font-semibold flex items-center gap-0.5 ${
                  delta > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {delta > 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                  <span className="whitespace-nowrap">{Math.abs(delta)}%</span>
                </span>
              );
            })()}
          </span>
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

    for (const nr of normalizedResponses) {
      const bucket = nr.company_mentioned ? mentionedDomains : notMentionedDomains;
      for (const d of nr.domains) bucket.add(d);
    }
    
    // A domain could appear in both sets if it has mixed mentions
    // For the summary, we want unique domains in each category
    const totalUniqueDomains = new Set([...mentionedDomains, ...notMentionedDomains]);
    
    return {
      mentioned: mentionedDomains.size,
      notMentioned: notMentionedDomains.size,
      total: totalUniqueDomains.size
    };
  }, [selectedSourceTypeFilter, normalizedResponses]);

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
  }, [selectedSourceTypeFilter, aiResponseCitations, searchResultCitations, allSourcesCitations, responsesByDomain, companyName, customMediaTypes]);

  return (
    <div className="flex flex-col gap-6 w-full h-full">
      {/* Main Section Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Sources</h2>
        <p className="text-gray-600">
          Discover where {companyName} is mentioned across the web and analyze source performance over time.
        </p>
      </div>

      {/* Toggle: Mentioned / Not Mentioned */}
      <div className="sticky top-0 z-10 bg-white pb-2">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-100">
          <button
            onClick={() => setSelectedCompanyMentionedFilter('mentioned')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              selectedCompanyMentionedFilter === 'mentioned'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Mentioned
          </button>
          <button
            onClick={() => setSelectedCompanyMentionedFilter('not-mentioned')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              selectedCompanyMentionedFilter === 'not-mentioned'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Not Mentioned
          </button>
        </div>
      </div>

      {/* Main Content with Tabs */}
      <div className="flex-1 min-h-0">
        <Card className="shadow-sm border border-gray-200 h-full flex flex-col">
          <CardContent className="flex-1 min-h-0 overflow-hidden p-3 sm:p-6">
            <div className="space-y-2 h-full overflow-y-auto relative">
              {allTimeCitationsWithChanges.length > 0 ? (
                (() => {
                  const maxCount = Math.max(...allTimeCitationsWithChanges.map(c => c.count), 1);
                  // Totals are across the FULL filtered set so percentages
                  // still add up correctly even when the render list is capped.
                  const totalCitations = allTimeCitationsWithChanges.reduce((sum, citation) => sum + citation.count, 0);
                  const totalPreviousCitations = allTimeCitationsWithChanges.reduce((sum, c) => sum + (c.previousCount || 0), 0);
                  // Only render the first INITIAL_RENDER_LIMIT rows unless the
                  // user clicks "Show all". Keeps mount fast on Netflix-scale orgs.
                  const toRender = showAllSources
                    ? allTimeCitationsWithChanges
                    : allTimeCitationsWithChanges.slice(0, INITIAL_RENDER_LIMIT);
                  return (
                    <>
                      {toRender.map((citation, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSourceClick({ domain: citation.name, count: citation.count })}
                          className="cursor-pointer"
                        >
                          {renderAllTimeBar(citation, maxCount, totalCitations, totalPreviousCitations)}
                        </div>
                      ))}
                      {!showAllSources && totalSourceCount > INITIAL_RENDER_LIMIT && (
                        <div className="pt-3 pb-2 text-center">
                          <Button variant="outline" size="sm" onClick={() => setShowAllSources(true)}>
                            Show all {totalSourceCount} sources
                          </Button>
                        </div>
                      )}
                    </>
                  );
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
          responseTexts={responseTexts}
          fetchResponseTexts={fetchResponseTexts}
        />
      )}
    </div>
  );
});
SourcesTab.displayName = 'SourcesTab';