import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ExternalLink } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { getCompetitorFavicon } from "@/utils/citationUtils";

interface CompetitorsSummaryCardProps {
  topCompetitors: { company: string; count: number }[];
  responses: any[];
  companyName: string;
  searchResults?: any[];
}

export const CompetitorsSummaryCard = ({ 
  topCompetitors, 
  responses, 
  companyName, 
  searchResults = [] 
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

  // Get top 5 competitors for the summary
  const topCompetitorsFiltered = useMemo(() => {
    // Excluded competitors and words
    const excludedCompetitors = new Set([
      'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
      'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
    ]);
    
    return topCompetitors
      .filter(competitor => 
        !excludedCompetitors.has(competitor.company.toLowerCase()) &&
        competitor.company.toLowerCase() !== companyName.toLowerCase() &&
        normalizeCompetitorName(competitor.company)
      )
      .slice(0, 5)
      .map(competitor => ({
        ...competitor,
        displayName: normalizeCompetitorName(competitor.company)
      }));
  }, [topCompetitors, companyName]);

  const renderCompetitorItem = (competitor: any) => {
    // Get favicon URL for competitor
    const faviconUrl = getCompetitorFavicon(competitor.displayName);
    const initials = competitor.displayName.charAt(0).toUpperCase();
    
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
                  // Fallback to initials if favicon fails to load
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
        
        {/* Count */}
        <div className="flex items-center min-w-[30px] justify-end">
          <span className="text-xs font-semibold text-gray-900">
            {competitor.count}
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
