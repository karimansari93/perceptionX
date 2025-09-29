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

interface SourceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: CitationCount;
  responses: any[];
  companyName?: string;
  searchResults?: any[];
}

export const SourceDetailsModal = ({ isOpen, onClose, source, responses, companyName, searchResults = [] }: SourceDetailsModalProps) => {
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

  // CSV download functionality
  const generateCSV = () => {
    if (!uniqueCitations || uniqueCitations.length === 0) {
      return '';
    }

    const headers = ['Title', 'Description', 'URLs', 'URL Count', 'Mention Count', 'Domain', 'Media Type'];
    const csvContent = [
      headers.join(','),
      ...uniqueCitations.map(citation => [
        `"${(citation.title || '').replace(/"/g, '""')}"`,
        `"${(citation.snippet || '').replace(/"/g, '""')}"`,
        `"${citation.urls ? citation.urls.join('; ') : citation.url}"`,
        citation.urlCount || 1,
        citation.mentionCount || 1,
        `"${citation.domain || source.domain}"`,
        `"${citation.mediaType || getEffectiveMediaType()}"`
      ].join(','))
    ].join('\n');

    return csvContent;
  };

  const downloadCSV = () => {
    const csvContent = generateCSV();
    if (!csvContent) {
      return;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${source.domain}-sources-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Fetch all unique URLs for this domain from the database and search results
  const fetchAllUrlsForDomain = async (domain: string) => {
    if (!domain) return [];
    
    try {
      setLoadingUrls(true);
      
      
      const citationsMap = new Map<string, any>();
      
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
      
      // Query all prompt_responses to find citations for this domain
      const { data: promptData, error: promptError } = await supabase
        .from('prompt_responses')
        .select('citations')
        .not('citations', 'is', null);

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
              citationUrl = citation.url;
            } else if (citation.source) {
              // Google AI Overviews format
              // Handle source names that might contain spaces or special characters
              let cleanSourceName = citation.source.toLowerCase().trim();
              
              // Check if source already looks like a domain (contains a dot)
              if (cleanSourceName.includes('.')) {
                // If source already looks like a domain, use it as-is
                citationDomain = cleanSourceName.replace(/^www\./, '');
              } else {
                // Handle specific known cases
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
                
                citationDomain = `${cleanSourceName}.com`;
              }
              
              citationUrl = citation.url;
            } else if (citation.url) {
              // Extract domain from URL if no domain/source field
              try {
                const urlObj = new URL(citation.url);
                citationDomain = urlObj.hostname.replace(/^www\./, '');
                citationUrl = citation.url;
              } catch {
                // Skip invalid URLs
              }
            }
            
            // Check if this citation matches our target domain
            // For Google AI Overviews, we need to handle different source formats
            let isMatch = false;
            
            if (citationDomain === domain) {
              isMatch = true;
            } else if (citation.source) {
              // Handle cases where source might be "Glassdoor" but domain is "glassdoor.com"
              const sourceLower = citation.source.toLowerCase();
              const domainLower = domain.toLowerCase();
              
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

      // Query search_insights_results to find citations for this domain
      // First get the most recent search session for this company
      const { data: sessionData, error: sessionError } = await supabase
        .from('search_insights_sessions')
        .select('id')
        .eq('company_name', companyName || '')
        .order('created_at', { ascending: false })
        .limit(1);

      if (sessionError) {
        console.error('Error fetching search session:', sessionError);
      }

      // Get the first (and only) result if any exist
      const session = sessionData && sessionData.length > 0 ? sessionData[0] : null;

      let searchData: any[] = [];
      if (session) {
        // Get all search results for this session and filter by domain
        const { data: allSearchResults, error: searchError } = await supabase
          .from('search_insights_results')
          .select('*')
          .eq('session_id', session.id);

        if (searchError) {
          console.error('Error fetching search results:', searchError);
        } else {
          // Filter by normalized domain comparison
          const normalizedTargetDomain = domain.replace(/^www\./, '').toLowerCase();
          searchData = (allSearchResults || []).filter(result => {
            const normalizedResultDomain = result.domain?.replace(/^www\./, '').toLowerCase();
            return normalizedResultDomain === normalizedTargetDomain;
          });
        }

      }

      // Process search results for this domain from database
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
          // Check search results
          searchResults.forEach(result => {
            if (result.link === citation.url && result.mentionCount) {
              mentionCount += result.mentionCount - 1; // Subtract 1 since we already counted it
            }
          });
          
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
          
          // Count mentions from search results in database
          searchData.forEach(result => {
            if (result.link === citation.url) {
              mentionCount += 1;
            }
          });
          
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

  // Fetch citations when modal opens
  useEffect(() => {
    if (isOpen && source?.domain) {
      fetchAllUrlsForDomain(source.domain).then(setUniqueCitations);
    }
  }, [isOpen, source?.domain]);

  // Get media type for this source using response data
  const mediaType = getEffectiveMediaType();
  const mediaTypeInfo = getMediaTypeInfo(mediaType);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] sm:w-auto max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <img src={getFavicon(source.domain)} alt="" className="w-5 h-5 object-contain" />
              <span>{source.domain}</span>
              <Badge variant="secondary">{source.count} citations</Badge>
            </DialogTitle>
            <Button
              onClick={downloadCSV}
              disabled={!uniqueCitations || uniqueCitations.length === 0}
              variant="outline"
              size="sm"
              className="hidden sm:flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </Button>
          </div>
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


            {/* URLs List */}
            <Card>
              <CardHeader>
                <CardTitle>Cited Sources</CardTitle>
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
                              // Multiple URLs - show them in a list
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
                              // Single URL - show as before
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