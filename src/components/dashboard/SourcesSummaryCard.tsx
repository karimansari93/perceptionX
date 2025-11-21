import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CitationCount } from "@/types/dashboard";
import { FileText, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Favicon } from "@/components/ui/favicon";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { categorizeSourceByMediaType, getMediaTypeInfo } from "@/utils/sourceConfig";

interface SourcesSummaryCardProps {
  topCitations: CitationCount[];
  responses: any[];
  companyName?: string;
  searchResults?: any[];
  perceptionScoreTrend?: any[];
}

export const SourcesSummaryCard = ({ 
  topCitations, 
  responses, 
  companyName, 
  searchResults = [],
  perceptionScoreTrend = []
}: SourcesSummaryCardProps) => {
  const navigate = useNavigate();

  // Local parseCitations function
  const parseCitations = (citations: any): any[] => {
    if (!citations) return [];
    if (Array.isArray(citations)) return citations;
    if (typeof citations === 'string') {
      try {
        const parsed = JSON.parse(citations);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  // Helper to format domain to a human-friendly name
  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, ""); // Remove www. if present
  };

  // Helper function to get responses for a source
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

  // Calculate source trends between latest and previous periods
  const sourceTrends = useMemo(() => {
    if (perceptionScoreTrend.length < 2) return {};
    
    const latestPeriod = perceptionScoreTrend[perceptionScoreTrend.length - 1];
    const previousPeriod = perceptionScoreTrend[perceptionScoreTrend.length - 2];
    
    // Get responses for each period
    const latestResponses = responses.filter(r => {
      const responseDate = new Date(r.tested_at).toISOString().split('T')[0];
      return responseDate === latestPeriod.fullDate;
    });
    
    const previousResponses = responses.filter(r => {
      const responseDate = new Date(r.tested_at).toISOString().split('T')[0];
      return responseDate === previousPeriod.fullDate;
    });
    
    // Calculate citation counts for each period
    const getCitationCounts = (responseList: any[]) => {
      const counts: { [key: string]: number } = {};
      responseList.forEach(response => {
        try {
          const citations = typeof response.citations === 'string' 
            ? JSON.parse(response.citations) 
            : response.citations;
          if (Array.isArray(citations)) {
            citations.forEach((c: any) => {
              if (c.domain) {
                counts[c.domain] = (counts[c.domain] || 0) + 1;
              }
            });
          }
        } catch {
          // Ignore invalid citations
        }
      });
      return counts;
    };
    
    const latestCounts = getCitationCounts(latestResponses);
    const previousCounts = getCitationCounts(previousResponses);
    
    // Calculate changes
    const trends: { [key: string]: number } = {};
    Object.keys(latestCounts).forEach(domain => {
      const latest = latestCounts[domain] || 0;
      const previous = previousCounts[domain] || 0;
      trends[domain] = latest - previous;
    });
    
    return trends;
  }, [perceptionScoreTrend, responses]);

  // Get top 5 sources for the summary with trend data
  const topSources = useMemo(() => {
    return topCitations.slice(0, 5).map(citation => ({
      ...citation,
      displayName: getSourceDisplayName(citation.domain),
      mediaType: categorizeSourceByMediaType(citation.domain, getResponsesForSource(citation.domain), companyName),
      trendChange: sourceTrends[citation.domain] || 0
    }));
  }, [topCitations, responses, companyName, sourceTrends]);

  const renderSourceItem = (source: any) => {
    const mediaTypeInfo = getMediaTypeInfo(source.mediaType);
    
    return (
      <div className="flex items-center justify-between py-2 hover:bg-gray-50/50 transition-colors rounded-lg px-2">
        {/* Source name and favicon */}
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <Favicon domain={source.domain} />
          <div className="min-w-0 flex items-center space-x-1">
            <span className="text-xs font-medium text-gray-900 truncate" title={source.displayName}>
              {source.displayName}
            </span>
            <Badge className={`text-xs px-1 py-0 h-4 ${mediaTypeInfo.colors}`}>
              {mediaTypeInfo.label}
            </Badge>
          </div>
        </div>
        
        {/* Count and trend */}
        <div className="flex items-center gap-1 min-w-[30px] justify-end">
          <span className="text-xs font-semibold text-gray-900">
            {source.count}
          </span>
          {source.trendChange !== 0 && (
            <span className={`text-xs font-semibold flex items-center gap-0.5 ${
              source.trendChange > 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {source.trendChange > 0 && <TrendingUp className="w-3 h-3 flex-shrink-0" />}
              {source.trendChange < 0 && <TrendingDown className="w-3 h-3 flex-shrink-0" />}
              <span className="whitespace-nowrap">{Math.abs(source.trendChange)}</span>
            </span>
          )}
        </div>
      </div>
    );
  };

  if (topSources.length === 0) {
    return (
      <Card className="shadow-sm border border-gray-200">
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="text-lg font-semibold">Sources</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No sources found yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border border-gray-200">
      <CardHeader className="pb-2 px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Sources</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard/sources')}
            className="text-xs"
          >
            View All
            <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <div className="space-y-1">
          {topSources.map((source, idx) => (
            <div key={idx}>
              {renderSourceItem(source)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
