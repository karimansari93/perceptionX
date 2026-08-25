import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { getCompetitorFavicon } from "@/utils/citationUtils";
import { poolCompetitorRows } from "@/hooks/dashboard/scopeStatsSelect";
import { quarterKeyOfMonthStr } from "@/utils/quarterKey";
import type { CompetitorStatsRow, ScopePromptTypeStatsRow } from "@/hooks/dashboard/dashboardQueries";
// Canonicalization now happens at the data layer (prompt_responses_canonical
// view). The card receives detected_competitors with variants already merged
// into canonical entities, so no client-side alias hook is needed.

interface CompetitorsSummaryCardProps {
  topCompetitors: { company: string; count: number }[];
  responses: any[];
  companyName: string;
  searchResults?: any[];
  perceptionScoreTrend?: any[];
  previousPeriodResponses?: any[];
  // True while the raw response stream is still arriving (it loads AFTER
  // first paint). This card derives its list from raw responses, so while
  // streaming it skeletons instead of "No competitor mentions found yet".
  responsesLoading?: boolean;
  // Phase-3 cubes. Rows arrive already location-filtered; this card pools
  // them by quarter + job function (+ prompt_type 'competitive'). BOTH cubes
  // must be present to switch: a cube numerator (each response counted once)
  // over a raw denominator (stitched rows double-counted) would skew the
  // coverage %. undefined on either = full raw fallback.
  competitorStatsRows?: CompetitorStatsRow[];
  cubePromptTypeRows?: ScopePromptTypeStatsRow[];
  cubeQuarterKey?: string | null;     // null = single period → no filter
  cubePrevQuarterKey?: string | null; // null = no previous period → no deltas
  selectedJobFunction?: string;       // 'all' = no filter; '' = untagged
}

export const CompetitorsSummaryCard = ({ 
  topCompetitors, 
  responses, 
  companyName, 
  searchResults = [],
  perceptionScoreTrend = [],
  previousPeriodResponses = [],
  responsesLoading = false,
  competitorStatsRows,
  cubePromptTypeRows,
  cubeQuarterKey = null,
  cubePrevQuarterKey = null,
  selectedJobFunction = 'all'
}: CompetitorsSummaryCardProps) => {
  const navigate = useNavigate();

  const cubeJobFunction = selectedJobFunction === 'all' ? null : selectedJobFunction;

  // Helper to normalize competitor names. Canonicalization happens server-side
  // (prompt_responses_canonical view), so this function only handles noise
  // filtering and display-name casing.
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

  // Competitive responses for each period — the analyzed sets. A competitor's
  // percentage is "share of these responses that mention it", matching the
  // Competitors tab.
  const competitiveResponses = useMemo(
    () => responses.filter(r => r.confirmed_prompts?.prompt_type === 'competitive'),
    [responses]
  );
  const prevCompetitiveResponses = useMemo(
    () => previousPeriodResponses.filter(r => r.confirmed_prompts?.prompt_type === 'competitive'),
    [previousPeriodResponses]
  );

  // Cube pools for the active quarter + job function, competitive prompts
  // only (rows are already location-filtered). undefined = fall back to raw
  // rows. previous stays undefined when there is no previous quarter →
  // deltas suppressed, matching raw with an empty previousPeriodResponses.
  const competitorPools = useMemo(() => {
    if (!competitorStatsRows || !cubePromptTypeRows) return undefined;
    return {
      current: poolCompetitorRows(competitorStatsRows, {
        quarterKey: cubeQuarterKey, jobFunction: cubeJobFunction, promptType: 'competitive'
      }),
      previous: cubePrevQuarterKey == null ? undefined : poolCompetitorRows(competitorStatsRows, {
        quarterKey: cubePrevQuarterKey, jobFunction: cubeJobFunction, promptType: 'competitive'
      }),
    };
  }, [competitorStatsRows, cubePromptTypeRows, cubeQuarterKey, cubePrevQuarterKey, cubeJobFunction]);

  // Coverage denominators (# competitive responses per period). Cube path
  // sums the prompt-type cube — each response counted once, unlike the raw
  // stream's stitched duplicates — pooled with the same filters as the
  // competitor pool so the ratio stays internally consistent.
  const cubeCompetitiveTotals = useMemo(() => {
    if (!competitorPools || !cubePromptTypeRows) return undefined;
    const sumFor = (quarterKey: string | null) =>
      cubePromptTypeRows.reduce((acc, r) => {
        if (r.prompt_type !== 'competitive') return acc;
        if (cubeJobFunction != null && r.job_function_context !== cubeJobFunction) return acc;
        if (quarterKey && quarterKeyOfMonthStr(String(r.response_month)) !== quarterKey) return acc;
        return acc + (r.total_responses || 0);
      }, 0);
    return {
      current: sumFor(cubeQuarterKey),
      previous: cubePrevQuarterKey == null ? 0 : sumFor(cubePrevQuarterKey),
    };
  }, [competitorPools, cubePromptTypeRows, cubeJobFunction, cubeQuarterKey, cubePrevQuarterKey]);

  const competitiveTotal = cubeCompetitiveTotals ? cubeCompetitiveTotals.current : competitiveResponses.length;
  const prevCompetitiveTotal = cubeCompetitiveTotals ? cubeCompetitiveTotals.previous : prevCompetitiveResponses.length;

  // Calculate competitor previous counts (responses mentioning each competitor,
  // deduped per response).
  const competitorPreviousCounts = useMemo(() => {
    if (competitorPools) {
      if (!competitorPools.previous) return {};
      const counts: { [key: string]: number } = {};
      competitorPools.previous.forEach(e => { counts[e.name] = e.mentions; });
      return counts;
    }

    if (prevCompetitiveResponses.length === 0) return {};

    const counts: { [key: string]: number } = {};
    prevCompetitiveResponses.forEach(response => {
      if (!response.detected_competitors) return;
      const seen = new Set<string>();
      response.detected_competitors
        .split(',')
        .map((c: string) => c.trim())
        .filter((c: string) => c.length > 0)
        .forEach((c: string) => {
          const name = normalizeCompetitorName(c);
          if (name && !seen.has(name)) {
            seen.add(name);
            counts[name] = (counts[name] || 0) + 1;
          }
        });
    });
    return counts;
  }, [competitorPools, prevCompetitiveResponses]);

  // Build the FULL list of direct competitors. Each competitor's count is the
  // number of competitive responses that mention it (deduped per response),
  // so the percentage is response coverage — matching the Competitors tab.
  const allCompetitorsFiltered = useMemo(() => {
    const excludedCompetitors = new Set([
      'glassdoor', 'indeed', 'ambitionbox', 'workday', 'linkedin', 'monster', 'careerbuilder', 'ziprecruiter',
      'dice', 'angelist', 'wellfound', 'builtin', 'stackoverflow', 'github'
    ]);

    if (competitorPools) {
      // Cube path: names arrive canonical (variants merged server-side), but
      // the job boards are legitimate entities the cube keeps, so the
      // exclusion list and the own-company filter still apply here.
      return Array.from(competitorPools.current.values())
        .filter(e => e.mentions > 0
          && e.name.toLowerCase() !== companyName.toLowerCase()
          && !excludedCompetitors.has(e.name.toLowerCase()))
        .sort((a, b) => b.mentions - a.mentions)
        .map(e => ({
          company: e.name,
          count: e.mentions,
          displayName: e.name,
          previousCount: competitorPreviousCounts[e.name] || 0
        }));
    }

    const counts: Record<string, number> = {};
    competitiveResponses.forEach(response => {
      if (!response.detected_competitors) return;
      const seen = new Set<string>();
      response.detected_competitors
        .split(',')
        .map((c: string) => c.trim())
        .filter((c: string) => c.length > 0)
        .forEach((c: string) => {
          const name = normalizeCompetitorName(c);
          if (name && name.toLowerCase() !== companyName.toLowerCase() && !excludedCompetitors.has(name.toLowerCase()) && !seen.has(name)) {
            seen.add(name);
            counts[name] = (counts[name] || 0) + 1;
          }
        });
    });

    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({
        company: name,
        count,
        displayName: name,
        previousCount: competitorPreviousCounts[name] || 0
      }));
  }, [competitorPools, competitiveResponses, companyName, competitorPreviousCounts]);

  const topCompetitorsFiltered = useMemo(
    () => allCompetitorsFiltered.slice(0, 5),
    [allCompetitorsFiltered],
  );

  const renderCompetitorItem = (competitor: any) => {
    const faviconUrl = getCompetitorFavicon(competitor.displayName);
    const initials = competitor.displayName.charAt(0).toUpperCase();
    // Coverage: share of competitive responses that mention this competitor.
    const mentionPercent = competitiveTotal > 0
      ? Math.min(100, (competitor.count / competitiveTotal) * 100)
      : 0;
    
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
        
        {/* Percentage and trend — fixed-width columns so values align right */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-900 w-10 text-right">
            {mentionPercent.toFixed(1)}%
          </span>
          {prevCompetitiveTotal > 0 && (
            <span className="w-[40px] flex justify-end">
              {(() => {
                if (!competitor.previousCount) return null;
                const prevPct = Math.min(100, (competitor.previousCount / prevCompetitiveTotal) * 100);
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
          )}
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
          {responsesLoading ? (
            <div className="space-y-3 py-2" aria-busy="true">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gray-100 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-8 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="w-8 h-8 mx-auto mb-2 bg-gray-100 rounded-full flex items-center justify-center">
                <span className="text-lg font-bold text-gray-400">🏢</span>
              </div>
              <p className="text-sm">No competitor mentions found yet.</p>
            </div>
          )}
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
