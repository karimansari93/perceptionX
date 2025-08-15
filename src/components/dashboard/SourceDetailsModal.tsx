import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResponseItem } from "./ResponseItem";
import { CitationCount } from "@/types/dashboard";
import { ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SourceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: CitationCount;
  responses: any[];
}

export const SourceDetailsModal = ({ isOpen, onClose, source, responses }: SourceDetailsModalProps) => {
  const [uniqueCitations, setUniqueCitations] = useState<any[]>([]);
  const [loadingUrls, setLoadingUrls] = useState(false);

  const getFavicon = (domain: string): string => {
    return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=32`;
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

  // Fetch all unique URLs for this domain from the database
  const fetchAllUrlsForDomain = async (domain: string) => {
    if (!domain) return [];
    
    try {
      setLoadingUrls(true);
      
      // Query all prompt_responses to find citations for this domain
      const { data, error } = await supabase
        .from('prompt_responses')
        .select('citations')
        .not('citations', 'is', null);

      if (error) {
        console.error('Error fetching citations:', error);
        return [];
      }

      const citationsMap = new Map<string, any>();
      
      // Process all citations from all users
      data?.forEach(response => {
        try {
          // First try to parse the raw citations directly
          let rawCitations = response.citations;
          if (typeof rawCitations === 'string') {
            try {
              rawCitations = JSON.parse(rawCitations);
            } catch {
              console.log('Failed to parse citations string:', rawCitations);
              return;
            }
          }
          
          if (!Array.isArray(rawCitations)) {
            console.log('Citations is not an array:', rawCitations);
            return;
          }
          
          console.log('Processing citations for domain:', domain, 'Raw citations:', rawCitations);
          
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
              citationDomain = citation.source;
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
            
            console.log('Citation processed:', { citation, citationDomain, citationUrl, targetDomain: domain });
            
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
              console.log('Adding citation:', citation);
              // Use URL as key to avoid duplicates, but store the full citation object
              citationsMap.set(citationUrl, citation);
            }
          });
        } catch (error) {
          console.error('Error processing citations:', error);
        }
      });

      return Array.from(citationsMap.values());
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] sm:w-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={getFavicon(source.domain)} alt="" className="w-5 h-5 object-contain" />
            <span>{source.domain}</span>
            <Badge variant="secondary">{source.count} citations</Badge>
          </DialogTitle>
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
                    <p className="text-sm text-gray-500">Total Citations</p>
                    <p className="font-medium">{source.count}</p>
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
                        className="p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors group"
                      >
                        <a
                          href={citation.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
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
                          
                          {/* Truncated URL */}
                          <div className="flex items-center gap-2">
                            <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                            <span className="text-xs text-blue-600 group-hover:text-blue-700 truncate">
                              {citation.url.length > 80 
                                ? citation.url.substring(0, 80) + '...' 
                                : citation.url
                              }
                            </span>
                          </div>
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">No URLs found for this source.</p>
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