import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResponseItem } from "./ResponseItem";
import { CitationCount } from "@/types/dashboard";
import { ExternalLink, Check, X, Download } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { categorizeSourceByMediaType, getMediaTypeInfo, MEDIA_TYPE_DESCRIPTIONS } from "@/utils/sourceConfig";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { extractSourceUrl, extractDomain } from "@/utils/citationUtils";
// Removed chart imports since we're rendering custom bars like SourcesTab

interface SourceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: CitationCount;
  responses: any[];
  companyName?: string;
  searchResults?: any[];
  companyId?: string;
  selectedThemeFilter?: string;
}

export const SourceDetailsModal = ({ isOpen, onClose, source, responses, companyName, searchResults = [], companyId, selectedThemeFilter = 'all' }: SourceDetailsModalProps) => {
  const [uniqueCitations, setUniqueCitations] = useState<any[]>([]);
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [editingMediaType, setEditingMediaType] = useState(false);
  const [customMediaType, setCustomMediaType] = useState<string | null>(null);

  const getFavicon = (domain: string): string => {
    const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=32`;
  };

  const parseAndEnhanceCitations = (citations: any) => {
    if (!citations) return [];
    try {
      const parsed = typeof citations === 'string' ? JSON.parse(citations) : citations;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const truncateText = (text: string, maxLength: number = 150) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const getSentimentColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'text-gray-600';
    if (sentimentScore > 0.1) return 'text-green-600';
    if (sentimentScore < -0.1) return 'text-red-600';
    return 'text-gray-600';
  };

  const getSentimentBgColor = (sentimentScore: number | null) => {
    if (!sentimentScore) return 'bg-gray-100';
    if (sentimentScore > 0.1) return 'bg-green-100';
    if (sentimentScore < -0.1) return 'bg-red-100';
    return 'bg-gray-100';
  };

  // Media type editing functions
  const handleMediaTypeEdit = () => {
    setEditingMediaType(true);
  };

  const handleMediaTypeSave = (newMediaType: string) => {
    setCustomMediaType(newMediaType);
    setEditingMediaType(false);
  };

  const handleMediaTypeCancel = () => {
    setEditingMediaType(false);
  };

  const getEffectiveMediaType = () => {
    // Check if there's a custom override
    if (customMediaType) {
      return customMediaType;
    }
    // Otherwise use the automatic categorization
    return categorizeSourceByMediaType(source.domain, responses, companyName);
  };


  // Fetch all unique URLs for this domain from the database and search results
  const fetchAllUrlsForDomain = async (domain: string) => {
    if (!domain) return [];
    
    try {
      setLoadingUrls(true);
      
      
      const citationsMap = new Map<string, any>();
      
      // Only add search results if no theme filter is active (search results don't have theme data)
      if (selectedThemeFilter === 'all') {
        // First, add search results from the passed searchResults prop
        searchResults.forEach(result => {
          // Normalize domain comparison - remove www prefix for comparison
          const normalizedResultDomain = result.domain?.replace(/^www\./, '').toLowerCase();
          const normalizedTargetDomain = domain.replace(/^www\./, '').toLowerCase();
          
          if (normalizedResultDomain === normalizedTargetDomain && result.link && result.title) {
            const citation = {
              url: result.link,
              title: result.title,
              snippet: result.snippet || '',
              domain: result.domain,
              source: result.domain,
              mediaType: result.media_type || 'organic',
              searchResult: true // Flag to identify search results
            };
            
            // Use URL as key to avoid duplicates
            citationsMap.set(result.link, citation);
          }
        });
      }
      
      // Query all prompt_responses to find citations for this domain
      // Filter by theme if a theme filter is selected
      let query = supabase
        .from('prompt_responses')
        .select(`
          citations,
          confirmed_prompts!inner(company_id, prompt_theme)
        `)
        .eq('confirmed_prompts.company_id', companyId)
        .not('citations', 'is', null);
      
      // Apply theme filter if selected
      if (selectedThemeFilter !== 'all') {
        query = query.eq('confirmed_prompts.prompt_theme', selectedThemeFilter);
      }
      
      const { data: promptData, error: promptError } = await query;

      if (promptError) {
        console.error('Error fetching prompt citations:', promptError);
      } else {
        // Process all citations from all users
        promptData?.forEach(response => {
        try {
          // First try to parse the raw citations directly
          let rawCitations = response.citations;
          if (typeof rawCitations === 'string') {
            try {
              rawCitations = JSON.parse(rawCitations);
            } catch {
              // Failed to parse citations string
              return;
            }
          }
          
          if (!Array.isArray(rawCitations)) {
            // Citations is not an array
            return;
          }
          
          // Process citations for the target domain
          rawCitations.forEach(citation => {
            // Handle different citation structures
            let citationDomain = '';
            let citationUrl = '';
            
            if (citation.domain) {
              // Perplexity format
              citationDomain = citation.domain;
              // Extract actual source URL if it's a Google Translate URL
              citationUrl = citation.url ? extractSourceUrl(citation.url) : '';
            } else if (citation.source) {
              // Google AI Overviews format
              const source = citation.source.toLowerCase().trim();
              
              // Extract actual source URL if it's a Google Translate URL
              citationUrl = citation.url ? extractSourceUrl(citation.url) : '';
              
              // If we have a URL, prefer extracting domain from URL (more reliable)
              if (citationUrl) {
                const extractedDomain = extractDomain(citationUrl);
                if (extractedDomain && extractedDomain !== citationUrl) {
                  citationDomain = extractedDomain;
                }
              }
              
              // Only use source name if we couldn't extract from URL
              if (!citationDomain) {
                // Map common source names to domains
                const sourceToDomainMap: Record<string, string> = {
                  'blind': 'www.teamblind.com',
                  'teamblind': 'www.teamblind.com',
                  'indeed': 'www.indeed.com',
                  'glassdoor': 'www.glassdoor.com',
                  'linkedin': 'www.linkedin.com',
                  'youtube': 'www.youtube.com',
                  'great place to work': 'www.greatplacetowork.com',
                  'greatplacetowork': 'www.greatplacetowork.com',
                  'comparably': 'www.comparably.com',
                  'ambitionbox': 'www.ambitionbox.com',
                  'repvue': 'www.repvue.com',
                  'built in': 'builtin.com',
                  'builtin': 'builtin.com',
                  'g2': 'www.g2.com',
                  'inhersight': 'www.inhersight.com',
                  'business because': 'www.businessbecause.com',
                  'businessbecause': 'www.businessbecause.com',
                  'ziprecruiter': 'www.ziprecruiter.com',
                  'snowflake careers': 'careers.snowflake.com',
                  'careers.snowflake.com': 'careers.snowflake.com',
                  'reddit': 'www.reddit.com',
                  'quora': 'www.quora.com',
                  'microsoft': 'www.microsoft.com',
                  'databricks': 'www.databricks.com',
                  'cloudera': 'www.cloudera.com',
                  'snowflake': 'www.snowflake.com',
                  'forbes': 'www.forbes.com',
                  'business insider': 'www.businessinsider.com',
                  'medium': 'medium.com',
                  'management consulted': 'managementconsulted.com'
                };
                
                // Check if source maps to a known domain
                if (sourceToDomainMap[source]) {
                  citationDomain = sourceToDomainMap[source];
                } else if (source.includes('.')) {
                  // If source already looks like a domain, use it as-is
                  citationDomain = source;
                } else {
                  // Fallback: try to convert source name to domain
                  let cleanSourceName = source;
                  if (cleanSourceName === 'great place to work') {
                    cleanSourceName = 'greatplacetowork';
                  } else if (cleanSourceName === 'built in') {
                    cleanSourceName = 'builtin';
                  } else {
                    // General case: remove spaces and special characters
                    cleanSourceName = cleanSourceName
                      .replace(/\s+/g, '') // Remove all spaces
                      .replace(/[^a-z0-9-]/g, '') // Remove special characters except hyphens
                      .replace(/-+/g, '-') // Replace multiple hyphens with single
                      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
                  }
                  // Only create domain if we have a valid source name
                  // Don't create ".com" if cleanSourceName is empty
                  if (cleanSourceName && cleanSourceName.length > 0) {
                    citationDomain = `${cleanSourceName}.com`;
                  }
                }
              }
            } else if (citation.url) {
              // Extract actual source URL if it's a Google Translate URL
              citationUrl = extractSourceUrl(citation.url);
              // Extract domain from URL if no domain/source field
              citationDomain = extractDomain(citationUrl);
            }
            
            // Check if this citation matches our target domain
            // Normalize both domains for comparison (remove www prefix and convert to lowercase)
            const normalizeDomain = (d: string) => d.trim().toLowerCase().replace(/^www\./, '');
            const normalizedTargetDomain = normalizeDomain(domain);
            const normalizedCitationDomain = normalizeDomain(citationDomain);
            
            let isMatch = false;
            
            if (normalizedCitationDomain === normalizedTargetDomain) {
              isMatch = true;
            } else if (citation.source) {
              // Handle cases where source might be "Glassdoor" but domain is "glassdoor.com"
              const sourceLower = citation.source.toLowerCase();
              const domainLower = normalizedTargetDomain.toLowerCase();
              
              if (sourceLower === domainLower || 
                  sourceLower === domainLower.replace(/^www\./, '') ||
                  sourceLower === domainLower.replace(/\.com$/, '') ||
                  sourceLower === domainLower.replace(/^www\./, '').replace(/\.com$/, '')) {
                isMatch = true;
              }
            }
            
            if (isMatch && citationUrl) {
              // Use URL as key to avoid duplicates, but store the full citation object
              citationsMap.set(citationUrl, citation);
            }
          });
        } catch (error) {
          console.error('Error processing citations:', error);
        }
      });
      }

      // Use searchResults prop instead of querying database
      // Only process search results if no theme filter is active (search results don't have theme data)
      if (selectedThemeFilter === 'all') {
        // Filter search results by domain
        const normalizedTargetDomain = domain.replace(/^www\./, '').toLowerCase();
        const searchData = (searchResults || []).filter(result => {
          const normalizedResultDomain = result.domain?.replace(/^www\./, '').toLowerCase();
          return normalizedResultDomain === normalizedTargetDomain;
        });

        // Process search results for this domain
        searchData.forEach(result => {
          if (result.link && result.title) {
            // Create a citation object that matches the expected format
            const citation = {
              url: result.link,
              title: result.title,
              snippet: result.snippet || '',
              domain: result.domain,
              source: result.domain,
              mediaType: result.media_type || 'organic',
              searchResult: true // Flag to identify search results
            };
            
            // Use URL as key to avoid duplicates
            citationsMap.set(result.link, citation);
          }
        });
      }

      // Group citations by title first, then by URL
      const titleGroups = new Map<string, any[]>();
      
      // Process all citations and group by title
      Array.from(citationsMap.values()).forEach(citation => {
        const title = citation.title?.trim() || 'Untitled';
        
        if (!titleGroups.has(title)) {
          titleGroups.set(title, []);
        }
        
        titleGroups.get(title)!.push(citation);
      });
      
      // Process each title group
      const groupedCitations = Array.from(titleGroups.entries()).map(([title, citations]) => {
        // For each title group, combine all URLs and count total mentions
        const allUrls = citations.map(c => c.url);
        const uniqueUrls = [...new Set(allUrls)]; // Remove duplicate URLs within the same title group
        
        // Calculate total mention count for this title group
        let totalMentionCount = 0;
        
        citations.forEach(citation => {
          let mentionCount = 1; // Start with 1 for the current citation
          
          // Count additional mentions from all sources
          // Only count search results if no theme filter is active
          if (selectedThemeFilter === 'all') {
            // Check search results
            searchResults.forEach(result => {
              if (result.link === citation.url && result.mentionCount) {
                mentionCount += result.mentionCount - 1; // Subtract 1 since we already counted it
              }
            });
          }
          
          // Count mentions from prompt responses
          promptData?.forEach(response => {
            try {
              let rawCitations = response.citations;
              if (typeof rawCitations === 'string') {
                try {
                  rawCitations = JSON.parse(rawCitations);
                } catch {
                  return;
                }
              }
              
              if (Array.isArray(rawCitations)) {
                rawCitations.forEach(citationItem => {
                  let citationUrl = '';
                  
                  if (citationItem.url) {
                    citationUrl = citationItem.url;
                  } else if (citationItem.source && citationItem.url) {
                    citationUrl = citationItem.url;
                  }
                  
                  if (citationUrl === citation.url) {
                    mentionCount += 1;
                  }
                });
              }
            } catch (error) {
              console.error('Error counting citations:', error);
            }
          });
          
          // Count mentions from search results in database (only if no theme filter)
          if (selectedThemeFilter === 'all') {
            const normalizedTargetDomain = domain.replace(/^www\./, '').toLowerCase();
            const searchData = (searchResults || []).filter(result => {
              const normalizedResultDomain = result.domain?.replace(/^www\./, '').toLowerCase();
              return normalizedResultDomain === normalizedTargetDomain;
            });
            
            searchData.forEach(result => {
              if (result.link === citation.url) {
                mentionCount += 1;
              }
            });
          }
          
          totalMentionCount += mentionCount;
        });
        
        // Use the first citation as the base, but include all URLs
        const baseCitation = citations[0];
        
        return {
          ...baseCitation,
          title: title,
          urls: uniqueUrls, // Array of all unique URLs for this title
          urlCount: uniqueUrls.length, // Number of unique URLs
          mentionCount: totalMentionCount, // Total mentions across all URLs
          grouped: uniqueUrls.length > 1, // Flag to indicate if this is a grouped result
          url: baseCitation.url // Keep the original URL for backward compatibility
        };
      });
      
      // Sort by mention count (most to least)
      return groupedCitations.sort((a, b) => b.mentionCount - a.mentionCount);
    } catch (error) {
      console.error('Error fetching URLs for domain:', error);
      return [];
    } finally {
      setLoadingUrls(false);
    }
  };

  // Fetch citations when modal opens or theme filter changes
  useEffect(() => {
    if (isOpen && source?.domain) {
      fetchAllUrlsForDomain(source.domain).then(setUniqueCitations);
    }
  }, [isOpen, source?.domain, selectedThemeFilter]);

  // Get media type for this source using response data
  const mediaType = getEffectiveMediaType();
  const mediaTypeInfo = getMediaTypeInfo(mediaType);

  // CSV download function
  const handleDownloadCSV = () => {
    if (uniqueCitations.length === 0) return;

    // CSV header
    const headers = ['Title', 'URL', 'All URLs', 'Mention Count', 'URL Count', 'Snippet'];
    
    // Convert citations to CSV rows
    const rows = uniqueCitations.map(citation => {
      const title = citation.title || 'Untitled';
      const primaryUrl = citation.url || '';
      const allUrls = citation.urls && citation.urls.length > 0 
        ? citation.urls.join('; ') 
        : primaryUrl;
      const mentionCount = citation.mentionCount || 1;
      const urlCount = citation.urlCount || 1;
      const snippet = (citation.snippet || '').replace(/"/g, '""'); // Escape quotes for CSV
      
      // Escape fields that might contain commas or quotes
      const escapeCSV = (field: string) => {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      };
      
      return [
        escapeCSV(title),
        escapeCSV(primaryUrl),
        escapeCSV(allUrls),
        mentionCount.toString(),
        urlCount.toString(),
        escapeCSV(snippet)
      ].join(',');
    });
    
    // Combine headers and rows
    const csvContent = [headers.join(','), ...rows].join('\n');
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cited-sources-${source.domain.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] sm:w-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={getFavicon(source.domain)} alt="" className="w-5 h-5 object-contain" />
            <span>{source.domain}</span>
            <Badge variant="secondary">{source.count} citations</Badge>
          </DialogTitle>
          <DialogDescription>
            View detailed information about citations from {source.domain} including all cited URLs and their sources.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[calc(90vh-8rem)]">
          <div className="space-y-6 pr-4">
            {/* Source Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Domain</p>
                    <a 
                      href={`https://${source.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium break-all text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      {source.domain}
                    </a>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Media Type</p>
                    <Popover open={editingMediaType} onOpenChange={(open) => !open && handleMediaTypeCancel()}>
                      <PopoverTrigger asChild>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge 
                                className={`${mediaTypeInfo.colors} cursor-pointer hover:opacity-80 transition-opacity`}
                                onClick={handleMediaTypeEdit}
                              >
                                {mediaTypeInfo.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Click to change media type</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3">
                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Change Media Type</h4>
                          <div className="space-y-2">
                            {Object.entries(MEDIA_TYPE_DESCRIPTIONS).map(([type, description]) => (
                              <button
                                key={type}
                                onClick={() => handleMediaTypeSave(type)}
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
                              onClick={handleMediaTypeCancel}
                              className="flex-1"
                            >
                              <X className="w-3 h-3 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-gray-500 mt-1">
                      {mediaTypeInfo.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>


            {/* Cited Sources Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Cited Sources</CardTitle>
                  {uniqueCitations.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadCSV}
                      className="flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download CSV
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingUrls ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-sm text-gray-500 mt-2">Loading URLs...</p>
                  </div>
                ) : uniqueCitations.length > 0 ? (
                  <div className="space-y-3">
                    {uniqueCitations.map((citation, index) => (
                      <div
                        key={index}
                        className="relative p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors group"
                      >
                        {/* Mention Count and URL Count Badges */}
                        <div className="absolute top-2 right-2 flex gap-2">
                          {citation.grouped && (
                            <Badge variant="outline" className="text-xs">
                              {citation.urlCount} URL{citation.urlCount > 1 ? 's' : ''}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            {citation.mentionCount || 1}
                          </Badge>
                        </div>
                        <div className="pr-24">
                          {/* Title */}
                          {citation.title && (
                            <h4 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors mb-1 line-clamp-2">
                              {citation.title}
                            </h4>
                          )}
                          {/* Snippet */}
                          {citation.snippet && (
                            <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                              {citation.snippet}
                            </p>
                          )}
                          {/* URLs */}
                          <div className="space-y-1">
                            {citation.urls && citation.urls.length > 1 ? (
                              <div className="space-y-1">
                                {citation.urls.map((url, urlIndex) => (
                                  <div key={urlIndex} className="flex items-center gap-2">
                                    <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 group-hover:text-blue-700 truncate hover:underline"
                                    >
                                      {url.length > 80 
                                        ? url.substring(0, 80) + '...'
                                        : url
                                      }
                                    </a>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                                <a
                                  href={citation.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 group-hover:text-blue-700 truncate hover:underline"
                                >
                                  {citation.url.length > 80 
                                    ? citation.url.substring(0, 80) + '...'
                                    : citation.url
                                  }
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">No unique URLs found for this source.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}; 