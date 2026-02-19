import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CitationCount } from "@/types/dashboard";
import { FileText, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Favicon } from "@/components/ui/favicon";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { categorizeSourceByMediaType, getMediaTypeInfo } from "@/utils/sourceConfig";
import { enhanceCitations } from "@/utils/citationUtils";

const normalizeDomain = (domain: string): string => {
  if (!domain) return '';
  return domain.trim().toLowerCase().replace(/^www\./, '');
};

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

  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, "");
  };

  // Compute citations from responses where company was mentioned,
  // using enhanceCitations + normalizeDomain (consistent with SourcesTab default view)
  const mentionedCitations = useMemo(() => {
    const citationCounts: Record<string, number> = {};

    const mentionedResponses = responses.filter(r => r.company_mentioned === true);

    mentionedResponses.forEach(response => {
      try {
        const raw = typeof response.citations === 'string'
          ? JSON.parse(response.citations)
          : response.citations;

        if (Array.isArray(raw)) {
          const enhanced = enhanceCitations(raw);
          enhanced.forEach(citation => {
            if (citation.type === 'website' && citation.domain) {
              const normalized = normalizeDomain(citation.domain);
              if (normalized) {
                citationCounts[normalized] = (citationCounts[normalized] || 0) + 1;
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
  }, [responses]);

  const getResponsesForSource = (domain: string) => {
    const normalized = normalizeDomain(domain);
    return responses.filter(response => {
      try {
        const raw = typeof response.citations === 'string'
          ? JSON.parse(response.citations)
          : response.citations;
        if (Array.isArray(raw)) {
          const enhanced = enhanceCitations(raw);
          return enhanced.some(c =>
            c.type === 'website' && c.domain && normalizeDomain(c.domain) === normalized
          );
        }
        return false;
      } catch {
        return false;
      }
    });
  };

  // Calculate source trends between latest and previous periods using normalized domains
  const sourceTrends = useMemo(() => {
    if (perceptionScoreTrend.length < 2) return {};

    const latestPeriod = perceptionScoreTrend[perceptionScoreTrend.length - 1];
    const previousPeriod = perceptionScoreTrend[perceptionScoreTrend.length - 2];

    const getCitationCounts = (responseList: any[]) => {
      const counts: Record<string, number> = {};
      responseList.forEach(response => {
        try {
          const raw = typeof response.citations === 'string'
            ? JSON.parse(response.citations)
            : response.citations;
          if (Array.isArray(raw)) {
            const enhanced = enhanceCitations(raw);
            enhanced.forEach(c => {
              if (c.type === 'website' && c.domain) {
                const normalized = normalizeDomain(c.domain);
                if (normalized) {
                  counts[normalized] = (counts[normalized] || 0) + 1;
                }
              }
            });
          }
        } catch {
          // Ignore invalid citations
        }
      });
      return counts;
    };

    const mentionedResponses = responses.filter(r => r.company_mentioned === true);

    const latestResponses = mentionedResponses.filter(r => {
      const responseDate = new Date(r.tested_at).toISOString().split('T')[0];
      return responseDate === latestPeriod.fullDate;
    });

    const previousResponses = mentionedResponses.filter(r => {
      const responseDate = new Date(r.tested_at).toISOString().split('T')[0];
      return responseDate === previousPeriod.fullDate;
    });

    const latestCounts = getCitationCounts(latestResponses);
    const previousCounts = getCitationCounts(previousResponses);

    const trends: Record<string, number> = {};
    Object.keys(latestCounts).forEach(domain => {
      trends[domain] = (latestCounts[domain] || 0) - (previousCounts[domain] || 0);
    });

    return trends;
  }, [perceptionScoreTrend, responses]);

  // Top 5 sources from mentioned-only citations (consistent with SourcesTab default)
  const topSources = useMemo(() => {
    return mentionedCitations.slice(0, 5).map(citation => ({
      ...citation,
      displayName: getSourceDisplayName(citation.domain),
      mediaType: categorizeSourceByMediaType(citation.domain, getResponsesForSource(citation.domain), companyName),
      trendChange: sourceTrends[citation.domain] || 0
    }));
  }, [mentionedCitations, responses, companyName, sourceTrends]);

  const totalSourceMentions = useMemo(() => {
    return topSources.reduce((sum, s) => sum + s.count, 0);
  }, [topSources]);

  const renderSourceItem = (source: any) => {
    const mediaTypeInfo = getMediaTypeInfo(source.mediaType);
    const mentionPercent = totalSourceMentions > 0 ? (source.count / totalSourceMentions) * 100 : 0;
    
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
        
        {/* Percentage and trend */}
        <div className="flex items-center gap-1 min-w-[40px] justify-end">
          <span className="text-xs font-semibold text-gray-900">
            {mentionPercent.toFixed(1)}%
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
