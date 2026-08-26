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
import { poolDomainRows } from "@/hooks/dashboard/scopeStatsSelect";
import { quarterKeyOfMonthStr } from "@/utils/quarterKey";
import type { DomainStatsRow, ScopeStatsRow } from "@/hooks/dashboard/dashboardQueries";

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
  previousPeriodResponses?: any[];
  // True while the raw response stream is still arriving (it loads AFTER
  // first paint). This card's denominator (mentioned responses) always comes
  // from raw responses, so while streaming it skeletons instead of "No
  // sources found yet".
  responsesLoading?: boolean;
  // True while any interactive cube is still on its first fetch for this
  // scope+location. The stream can finish BEFORE the cubes (they chain
  // behind location rollups on a switch), so the empty state must wait for
  // both.
  cubesLoading?: boolean;
  // Phase-3 domain cube. Rows arrive already location-filtered; this card
  // pools them by quarter + job function. undefined = scope not backfilled
  // yet → every aggregation below falls back to the raw-row scan.
  domainStatsRows?: DomainStatsRow[];
  // Scope-stats cube (also location-filtered): supplies the mentioned-response
  // denominators. The cube path needs BOTH cubes — a cube numerator over the
  // partially-streamed raw denominator would inflate every coverage %.
  cubeScopeRows?: ScopeStatsRow[];
  cubeQuarterKey?: string | null;     // null = single period → no filter
  cubePrevQuarterKey?: string | null; // null = no previous period → no deltas
  selectedJobFunction?: string;       // 'all' = no filter; '' = untagged
}

export const SourcesSummaryCard = ({ 
  topCitations, 
  responses, 
  companyName, 
  searchResults = [],
  perceptionScoreTrend = [],
  previousPeriodResponses = [],
  responsesLoading = false,
  cubesLoading = false,
  domainStatsRows,
  cubeScopeRows,
  cubeQuarterKey = null,
  cubePrevQuarterKey = null,
  selectedJobFunction = 'all'
}: SourcesSummaryCardProps) => {
  const navigate = useNavigate();

  const getSourceDisplayName = (domain: string) => {
    return domain.replace(/^www\./, "");
  };

  // Responses where the company was mentioned — the analyzed set, matching the
  // Sources tab's default "Mentioned" view. Stays raw on BOTH paths: it is
  // the coverage denominator, and the domain cube cannot supply it (summing
  // per-domain rows overcounts responses citing several sources).
  const mentionedResponses = useMemo(
    () => responses.filter(r => r.company_mentioned === true),
    [responses]
  );

  const cubeJobFunction = selectedJobFunction === 'all' ? null : selectedJobFunction;

  // Cube pool for the active quarter + job function (rows are already
  // location-filtered). undefined = fall back to raw rows. Requires the scope
  // cube too: every % below divides by a mentioned-responses total, and mixing
  // a full-quarter cube numerator with the still-streaming raw denominator
  // would peg coverage at the clamp until the stream finishes.
  const domainPool = useMemo(
    () => domainStatsRows && cubeScopeRows
      ? poolDomainRows(domainStatsRows, { quarterKey: cubeQuarterKey, jobFunction: cubeJobFunction })
      : undefined,
    [domainStatsRows, cubeScopeRows, cubeQuarterKey, cubeJobFunction]
  );

  // Mentioned-response totals from the scope cube (deduped per response, same
  // exclusions as the domain cube — a consistent basis for coverage %).
  const cubeMentionedTotals = useMemo(() => {
    if (!cubeScopeRows) return null;
    const sumFor = (quarterKey: string | null): number => {
      let total = 0;
      for (const r of cubeScopeRows) {
        if (quarterKey && (!r.response_month || quarterKeyOfMonthStr(String(r.response_month)) !== quarterKey)) continue;
        if (cubeJobFunction != null && r.job_function_context !== cubeJobFunction) continue;
        total += r.mentioned_responses || 0;
      }
      return total;
    };
    return {
      current: sumFor(cubeQuarterKey),
      previous: cubePrevQuarterKey != null ? sumFor(cubePrevQuarterKey) : 0,
    };
  }, [cubeScopeRows, cubeQuarterKey, cubePrevQuarterKey, cubeJobFunction]);

  // Coverage denominator: cube when active, raw stream otherwise.
  const mentionedTotal = domainPool && cubeMentionedTotals
    ? cubeMentionedTotals.current
    : mentionedResponses.length;

  // Count, per domain, how many mentioned responses cite it (deduped per
  // response). This is the coverage numerator — consistent with SourcesTab.
  const mentionedCitations = useMemo(() => {
    if (domainPool) {
      // Cube path: mentioned_responses_citing is already deduped per response
      // and the domains arrive normalized. An empty cube denominator (no
      // mentioned responses in the selection) yields the same empty list the
      // raw scan would — never a list of 0.0% rows.
      if (mentionedTotal === 0) return [];
      // 'unknown' is the stored bucket for context-less citations — the raw
      // path resolves or drops those via enhanceCitations, and SourcesTab's
      // cube path filters them; exclude here too.
      return Array.from(domainPool.values())
        .filter(e => e.mentionedResponsesCiting > 0 && e.domain && e.domain !== 'unknown')
        .map(e => ({ domain: e.domain, count: e.mentionedResponsesCiting }))
        .sort((a, b) => b.count - a.count);
    }

    const citationCounts: Record<string, number> = {};

    mentionedResponses.forEach(response => {
      try {
        const raw = typeof response.citations === 'string'
          ? JSON.parse(response.citations)
          : response.citations;

        if (Array.isArray(raw)) {
          const enhanced = enhanceCitations(raw);
          const seen = new Set<string>();
          enhanced.forEach(citation => {
            if (citation.type === 'website' && citation.domain) {
              const normalized = normalizeDomain(citation.domain);
              if (normalized && !seen.has(normalized)) {
                seen.add(normalized);
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
  }, [domainPool, mentionedTotal, mentionedResponses]);

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

  // Calculate source trends: compare coverage % (responses citing the source ÷
  // mentioned responses) between current and previous periods.
  const sourceTrends = useMemo(() => {
    if (domainPool && domainStatsRows && cubeMentionedTotals) {
      // Cube path: pool the previous quarter and diff coverage %. No previous
      // quarter, or a previous quarter with zero mentioned responses for the
      // selected function (e.g. a function first tagged this quarter), means
      // there is nothing to compare — no deltas, matching the raw path's
      // empty fnPreviousResponses. Both denominators come from the scope
      // cube, the same basis as the numerators.
      if (cubePrevQuarterKey == null || cubeMentionedTotals.previous === 0) return {};
      const prevPool = poolDomainRows(domainStatsRows, { quarterKey: cubePrevQuarterKey, jobFunction: cubeJobFunction });
      const currentTotal = cubeMentionedTotals.current;
      const previousTotal = cubeMentionedTotals.previous;
      const trends: Record<string, number> = {};
      domainPool.forEach(entry => {
        const currentPct = currentTotal > 0 ? (entry.mentionedResponsesCiting / currentTotal) * 100 : 0;
        const previousCiting = prevPool.get(entry.domain)?.mentionedResponsesCiting || 0;
        const previousPct = previousTotal > 0 ? (previousCiting / previousTotal) * 100 : 0;
        trends[entry.domain] = currentPct - previousPct;
      });
      return trends;
    }

    if (previousPeriodResponses.length === 0) return {};

    const getCoverage = (responseList: any[]) => {
      const counts: Record<string, number> = {};
      const mentioned = responseList.filter(r => r.company_mentioned === true);
      mentioned.forEach(response => {
        try {
          const raw = typeof response.citations === 'string'
            ? JSON.parse(response.citations)
            : response.citations;
          if (Array.isArray(raw)) {
            const enhanced = enhanceCitations(raw);
            const seen = new Set<string>();
            enhanced.forEach(c => {
              if (c.type === 'website' && c.domain) {
                const normalized = normalizeDomain(c.domain);
                if (normalized && !seen.has(normalized)) {
                  seen.add(normalized);
                  counts[normalized] = (counts[normalized] || 0) + 1;
                }
              }
            });
          }
        } catch {
          // Ignore invalid citations
        }
      });
      return { counts, total: mentioned.length };
    };

    const current = getCoverage(responses);
    const previous = getCoverage(previousPeriodResponses);

    const trends: Record<string, number> = {};
    Object.keys(current.counts).forEach(domain => {
      const currentPct = current.total > 0 ? ((current.counts[domain] || 0) / current.total) * 100 : 0;
      const previousPct = previous.total > 0 ? ((previous.counts[domain] || 0) / previous.total) * 100 : 0;
      trends[domain] = currentPct - previousPct;
    });

    return trends;
  }, [domainPool, domainStatsRows, cubeMentionedTotals, cubePrevQuarterKey, cubeJobFunction, responses, previousPeriodResponses]);

  // Media type per domain. Cube path classifies from the domain + company
  // name alone and applies the majority-absent "competitive" override from
  // pooled counts (SourcesTab's rule) — no citation re-scan. Raw path keeps
  // the full response scan.
  const mediaTypeForDomain = (domain: string) => {
    if (domainPool) {
      const base = categorizeSourceByMediaType(domain, [], companyName);
      const entry = domainPool.get(domain);
      if (!entry || base === 'owned') return base;
      const notMentioned = entry.responsesCiting - entry.mentionedResponsesCiting;
      return notMentioned <= entry.mentionedResponsesCiting ? base : 'competitive';
    }
    return categorizeSourceByMediaType(domain, getResponsesForSource(domain), companyName);
  };

  // Top 5 sources from mentioned-only citations (consistent with SourcesTab default)
  const topSources = useMemo(() => {
    return mentionedCitations.slice(0, 5).map(citation => ({
      ...citation,
      displayName: getSourceDisplayName(citation.domain),
      mediaType: mediaTypeForDomain(citation.domain),
      trendChange: sourceTrends[citation.domain] || 0
    }));
  }, [mentionedCitations, domainPool, responses, companyName, sourceTrends]);

  // Delta column: on the cube path it exists when the previous quarter has
  // mentioned responses for the selection to compare against (independent of
  // the raw stream); raw gates on having previous-period rows.
  const hasPreviousPeriod = domainPool && cubeMentionedTotals
    ? cubePrevQuarterKey != null && cubeMentionedTotals.previous > 0
    : previousPeriodResponses.length > 0;

  const renderSourceItem = (source: any) => {
    const mediaTypeInfo = getMediaTypeInfo(source.mediaType);
    // Coverage: share of mentioned responses that cite this source. On the
    // cube path numerator and denominator share one basis (the cubes).
    const mentionPercent = mentionedTotal > 0
      ? Math.min(100, (source.count / mentionedTotal) * 100)
      : 0;

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

        {/* Percentage and trend — fixed-width columns so values align right */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-900 w-10 text-right">
            {mentionPercent.toFixed(1)}%
          </span>
          {hasPreviousPeriod && (
            <span className="w-[40px] flex justify-end">
              {(() => {
                const delta = Math.round(source.trendChange);
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

  if (topSources.length === 0) {
    return (
      <Card className="shadow-sm border border-gray-200">
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="text-lg font-semibold">Sources</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {(responsesLoading || cubesLoading) && !domainPool ? (
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
              <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No sources found yet.</p>
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
