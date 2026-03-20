import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { getCompetitorFavicon } from "@/utils/citationUtils";

interface CompetitorsSummaryCardProps {
  topCompetitors: { company: string; count: number }[];
  responses: any[];
  companyName: string;
  searchResults?: any[];
  perceptionScoreTrend?: any[];
  previousPeriodResponses?: any[];
}

export const CompetitorsSummaryCard = ({ 
  topCompetitors, 
  responses, 
  companyName, 
  searchResults = [],
  perceptionScoreTrend = [],
  previousPeriodResponses = []
}: CompetitorsSummaryCardProps) => {
  const navigate = useNavigate();

  // Helper to normalize competitor names
  const normalizeCompetitorName = (name: string): string => {
    const trimmedName = name.trim();
    const lowerName = trimmedName.toLowerCase();
    
    // Check for excluded patterns first
    const excludedPatterns = [
      /^none$/i,
      /^n\/a$/i,
      /^na$/i,
      /^null$/i,
      /^undefined$/i,
      /^none\.?$/i,
      /^n\/a\.?$/i,
      /^na\.?$/i,
      /^null\.?$/i,
      /^undefined\.?$/i,
      /^none[,:;\)\]\}\-_]$/i,
      /^n\/a[,:;\)\]\}\-_]$/i,
      /^na[,:;\)\]\}\-_]$/i,
      /^null[,:;\)\]\}\-_]$/i,
      /^undefined[,:;\)\]\}\-_]$/i,
      /^[0-9]+$/i, // Pure numbers
      /^[^a-zA-Z0-9]+$/i, // Only special characters
      /^[a-z]{1,2}$/i, // Single or double letter words (likely abbreviations that aren't company names)
    ];
    
    // If the name matches any excluded pattern, return empty string
    if (excludedPatterns.some(pattern => pattern.test(trimmedName))) {
      return '';
    }
    
    // Check for excluded words
    const excludedWords = new Set([
      'none', 'n/a', 'na', 'null', 'undefined', 'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;',
      'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_',
      'null.', 'null,', 'null:', 'null;', 'null)', 'null]', 'null}', 'null-', 'null_',
      'undefined.', 'undefined,', 'undefined:', 'undefined;', 'undefined)', 'undefined]', 'undefined}', 'undefined_',
      'n/a', 'n/a.', 'n/a,', 'n/a:', 'n/a;', 'n/a)', 'n/a]', 'n/a}', 'n/a-', 'n/a_',
      'none', 'none.', 'none,', 'none:', 'none;', 'none)', 'none]', 'none}', 'none-', 'none_',
      'na', 'na.', 'na,', 'na:', 'na;', 'na)', 'na]', 'na}', 'na-', 'na_'
    ]);
    
    if (excludedWords.has(lowerName)) {
      return '';
    }
    
    // If name is too short or empty after trimming, return empty string
    if (trimmedName.length <= 1) {
      return '';
    }
    
    const aliases: { [key: string]: string } = {
      'amazon web services': 'AWS',
      'google cloud': 'GCP',
      // Add other aliases as needed
    };
    for (const alias in aliases) {
      if (lowerName === alias) {
        return aliases[alias];
      }
    }
    return trimmedName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  // Calculate competitor previous counts from competitive prompts only
  const competitorPreviousCounts = useMemo(() => {
    if (previousPeriodResponses.length === 0) return {};

    const counts: { [key: string]: number } = {};
    previousPeriodResponses
      .filter(r => r.confirmed_prompts?.prompt_type === 'competitive' || r.confirmed_prompts?.prompt_type === 'talentx_competitive')
      .forEach(response => {
        if (!response.detected_competitors) return;
        response.detected_competitors
          .split(',')
          .map((c: string) => c.trim())
          .filter((c: string) => c.length > 0)
          .forEach((c: string) => {
            const name = normalizeCompetitorName(c);
            if (name) {
              counts[name] = (counts[name] || 0) + 1;
            }
          });
      });
    return counts;
  }, [previousPeriodResponses]);

  // Get top 5 direct competitors from competitive prompts only (matching Competitors tab default)
  const topCompetitorsFiltered = useMemo(() => {
    const excludedCompetitors = new Set([
      'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
      'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
    ]);

    // Count competitors from competitive prompt responses only
    const counts: Record<string, number> = {};
    responses
      .filter(r => r.confirmed_prompts?.prompt_type === 'competitive' || r.confirmed_prompts?.prompt_type === 'talentx_competitive')
      .forEach(response => {
        if (!response.detected_competitors) return;
        response.detected_competitors
          .split(',')
          .map((c: string) => c.trim())
          .filter((c: string) => c.length > 0)
          .forEach((c: string) => {
            const name = normalizeCompetitorName(c);
            if (name && name.toLowerCase() !== companyName.toLowerCase() && !excludedCompetitors.has(name.toLowerCase())) {
              counts[name] = (counts[name] || 0) + 1;
            }
          });
      });

    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({
        company: name,
        count,
        displayName: name,
        previousCount: competitorPreviousCounts[name] || 0
      }));
  }, [responses, companyName, competitorPreviousCounts]);

  const totalCompetitorMentions = useMemo(() => {
    return topCompetitorsFiltered.reduce((sum, c) => sum + c.count, 0);
  }, [topCompetitorsFiltered]);

  const totalPreviousMentions = useMemo(() => {
    return topCompetitorsFiltered.reduce((sum, c) => sum + (c.previousCount || 0), 0);
  }, [topCompetitorsFiltered]);

  const renderCompetitorItem = (competitor: any) => {
    const faviconUrl = getCompetitorFavicon(competitor.displayName);
    const initials = competitor.displayName.charAt(0).toUpperCase();
    const mentionPercent = totalCompetitorMentions > 0 ? (competitor.count / totalCompetitorMentions) * 100 : 0;
    
    return (
      <div className="flex items-center justify-between py-2 hover:bg-gray-50/50 transition-colors rounded-lg px-2">
        {/* Competitor name with favicon */}
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="w-4 h-4 flex-shrink-0 bg-blue-100 rounded flex items-center justify-center">
            {faviconUrl ? (
              <img 
                src={faviconUrl} 
                alt={`${competitor.displayName} favicon`}
                className="w-full h-full rounded object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
                style={{ display: 'block' }}
              />
            ) : null}
            <span 
              className="text-xs font-bold text-blue-600"
              style={{ display: faviconUrl ? 'none' : 'flex' }}
            >
              {initials}
            </span>
          </div>
          <span className="text-xs font-medium text-gray-900 truncate" title={competitor.displayName}>
            {competitor.displayName}
          </span>
        </div>
        
        {/* Percentage and trend */}
        <div className="flex items-center gap-1 min-w-[40px] justify-end">
          <span className="text-xs font-semibold text-gray-900">
            {mentionPercent.toFixed(1)}%
          </span>
          <span className="w-[40px] flex justify-end">
            {(() => {
              if (!competitor.previousCount || totalPreviousMentions === 0) return null;
              const prevPct = (competitor.previousCount / totalPreviousMentions) * 100;
              const delta = Math.round(mentionPercent - prevPct);
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

  if (topCompetitorsFiltered.length === 0) {
    return (
      <Card className="shadow-sm border border-gray-200">
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="text-lg font-semibold">Competitors</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="text-center py-8 text-gray-500">
            <div className="w-8 h-8 mx-auto mb-2 bg-gray-100 rounded-full flex items-center justify-center">
              <span className="text-lg font-bold text-gray-400">🏢</span>
            </div>
            <p className="text-sm">No competitor mentions found yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border border-gray-200">
      <CardHeader className="pb-2 px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Competitors</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard/competitors')}
            className="text-xs"
          >
            View All
            <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <div className="space-y-1">
          {topCompetitorsFiltered.map((competitor, idx) => (
            <div key={idx}>
              {renderCompetitorItem(competitor)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
