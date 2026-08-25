import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ExternalLink, Target, Award, Users, Heart, Shield, Lightbulb, Coffee, Crown, Lock, MessageSquare, MessageCircle, ClipboardList, UserCheck } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ATTRIBUTES, normalizeAttributeId } from "@/config/attributes";
import { sentimentRatioV2 } from "@/lib/sentimentV2";
import { quarterKeyOfMonthStr } from "@/utils/quarterKey";

interface AttributesSummaryCardProps {
  aiThemes?: any[];
  // Pre-aggregated attribute scores from company_attribute_themes_mv. When
  // present, the card renders from these instead of scanning raw aiThemes.
  attributeThemes?: any[];
  companyName?: string;
  perceptionScoreTrend?: any[];
  previousPeriodResponses?: any[];
  responses?: any[];
  aiThemesLoading?: boolean;
  // Explicit period/function scoping for the MV rows. When provided
  // (undefined = not wired, fall back to the response key-set scoping), the
  // card filters MV rows by the quarter of their response_month directly —
  // no dependency on the raw response stream having loaded, so it paints
  // final numbers immediately on warm starts and never over-includes rows
  // pre-hydration.
  cubeQuarterKey?: string | null;     // null = single period → no filter
  cubePrevQuarterKey?: string | null; // null = no previous period → no deltas
  selectedJobFunction?: string;       // 'all' = no filter
}

// Attribute icon mapping (methodology v2 ids — legacy v1 ids are folded into
// their v2 successor via normalizeAttributeId before reaching this map).
const ATTRIBUTE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'mission-purpose-impact': Heart,
  'compensation': Award,
  'company-culture': Users,
  'leadership': Crown,
  'job-security': Lock,
  'career-opportunities': TrendingUp,
  'wellbeing-balance': Coffee,
  'inclusion': Shield,
  'innovation': Lightbulb,
  'application-communication': MessageSquare,
  'candidate-feedback': MessageCircle,
  'interview-experience': ClipboardList,
  'onboarding-experience': UserCheck
};

export const AttributesSummaryCard = ({
  aiThemes = [],
  attributeThemes = [],
  companyName,
  perceptionScoreTrend = [],
  previousPeriodResponses = [],
  responses = [],
  aiThemesLoading = false,
  cubeQuarterKey,
  cubePrevQuarterKey,
  selectedJobFunction = 'all'
}: AttributesSummaryCardProps) => {
  const navigate = useNavigate();

  // Pre-aggregated path: build the top attributes from the MV rows
  // (company_attribute_themes_mv) instead of scanning raw themes. Scope is
  // derived from the (month, job function) of the in-scope `responses`, which
  // are already period/function-filtered upstream — this mirrors the old
  // "themes belonging to these responses" semantics at the MV's grain.
  const mvAttributeScores = useMemo(() => {
    if (!attributeThemes || attributeThemes.length === 0) return null;

    // Scope keys stay at the MV's month grain — a quarterly period simply
    // contributes every month key it contains. Responses key on their own
    // response_month (the collection-cycle month) so they match the MV's
    // bucketing exactly: a row tested Aug 3 but tagged to the July cycle
    // must match the MV's July rows. tested_at is only a legacy fallback.
    const monthOf = (r: any): string => {
      if (r.response_month) return String(r.response_month).slice(0, 7);
      const d = new Date(r.tested_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const respKey = (r: any) => `${monthOf(r)}|${(r.confirmed_prompts?.job_function_context || '').trim()}`;
    const rowKey = (row: any) => `${String(row.response_month).slice(0, 7)}|${(row.job_function_context || '').trim()}`;

    // Explicit cube scoping (quarter of the row's response_month + the
    // function pill) when wired; otherwise the legacy response key-sets.
    const cubeMode = cubeQuarterKey !== undefined;
    const fnOf = (row: any) => (row.job_function_context || '').trim();
    const rowQuarter = (row: any) => row.response_month ? quarterKeyOfMonthStr(String(row.response_month)) : null;
    const fnMatches = (row: any) => selectedJobFunction === 'all' || fnOf(row) === selectedJobFunction;

    const currentKeys = new Set(responses.map(respKey));
    const prevKeys = new Set(previousPeriodResponses.map(respKey));
    const scopeCurrent = currentKeys.size > 0; // before responses load, include all MV rows

    const inCurrent = (row: any, k: string) => cubeMode
      ? fnMatches(row) && (!cubeQuarterKey || rowQuarter(row) === cubeQuarterKey)
      : (!scopeCurrent || currentKeys.has(k));
    const inPrev = (row: any, k: string) => cubeMode
      ? fnMatches(row) && cubePrevQuarterKey != null && rowQuarter(row) === cubePrevQuarterKey
      : prevKeys.has(k);

    const agg: Record<string, { count: number; positive: number; negative: number; neutral: number; scoreSum: number }> = {};
    const prevCounts: Record<string, number> = {};
    let currTotal = 0;
    let prevTotal = 0;

    attributeThemes.forEach(row => {
      // Fold legacy v1 attribute rows (still present in the MV for existing
      // clients) into their v2 successor; drop retired ids.
      const attrId = normalizeAttributeId(row.attribute_id);
      if (!attrId) return;
      const k = rowKey(row);
      const total = Number(row.total_themes) || 0;
      if (inCurrent(row, k)) {
        if (!agg[attrId]) agg[attrId] = { count: 0, positive: 0, negative: 0, neutral: 0, scoreSum: 0 };
        const a = agg[attrId];
        a.count += total;
        a.positive += Number(row.positive_themes) || 0;
        a.negative += Number(row.negative_themes) || 0;
        a.neutral += Number(row.neutral_themes) || 0;
        a.scoreSum += (Number(row.avg_sentiment_score) || 0) * total;
        currTotal += total;
      }
      if (inPrev(row, k)) {
        prevCounts[attrId] = (prevCounts[attrId] || 0) + total;
        prevTotal += total;
      }
    });

    const attrName = (id: string) => ATTRIBUTES.find(a => a.id === id)?.name || id;

    return Object.entries(agg)
      .map(([id, a]) => {
        const currPct = currTotal > 0 ? (a.count / currTotal) * 100 : 0;
        const prevPct = prevTotal > 0 ? ((prevCounts[id] || 0) / prevTotal) * 100 : 0;
        return {
          id,
          name: attrName(id),
          count: a.count,
          positiveCount: a.positive,
          negativeCount: a.negative,
          neutralCount: a.neutral,
          avgSentimentScore: a.count > 0 ? a.scoreSum / a.count : 0,
          // Delta chips: in cube mode they exist iff there is a previous
          // quarter to compare; legacy mode gates on the raw prev stream.
          trendChange: (cubeMode ? cubePrevQuarterKey != null : previousPeriodResponses.length > 0)
            ? Math.round(currPct - prevPct)
            : 0,
        };
      })
      .filter(a => a.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [attributeThemes, responses, previousPeriodResponses, cubeQuarterKey, cubePrevQuarterKey, selectedJobFunction]);

  // Calculate theme trends: share of mentions % (current period) - share of mentions % (previous period)
  const themeTrends = useMemo(() => {
    if (previousPeriodResponses.length === 0 || aiThemesLoading) return {};

    const currentResponseIds = new Set(responses.map((r: any) => r.id));
    const prevResponseIds = new Set(previousPeriodResponses.map((r: any) => r.id));

    const currentThemes = aiThemes.filter(t => currentResponseIds.has(t.response_id));
    const prevThemes = aiThemes.filter(t => prevResponseIds.has(t.response_id));

    // Count mentions per attribute (legacy ids folded into their v2 successor).
    const countByAttr = (themes: any[]) => {
      const c: Record<string, number> = {};
      themes.forEach(t => {
        const id = normalizeAttributeId(t.attribute_id);
        if (id) c[id] = (c[id] || 0) + 1;
      });
      return c;
    };

    const currCounts = countByAttr(currentThemes);
    const prevCounts = countByAttr(prevThemes);
    const currTotal = currentThemes.length;
    const prevTotal = prevThemes.length;

    const trends: { [key: string]: number } = {};
    Object.keys(currCounts).forEach(id => {
      const currPct = currTotal > 0 ? (currCounts[id] / currTotal) * 100 : 0;
      const prevPct = prevTotal > 0 ? ((prevCounts[id] || 0) / prevTotal) * 100 : 0;
      trends[id] = Math.round(currPct - prevPct);
    });

    return trends;
  }, [aiThemes, responses, previousPeriodResponses, aiThemesLoading]);

  // Calculate most mentioned attributes from AI themes
  const mostMentionedThemes = useMemo(() => {
    if (aiThemes.length === 0) return [];

    // Group themes by attribute and count mentions
    const attributeCounts: Record<string, {
      count: number;
      name: string;
      positiveCount: number;
      negativeCount: number;
      neutralCount: number;
      avgSentimentScore: number;
    }> = {};

    // Fold legacy v1 ids into their v2 successor once, up front.
    const normThemes = aiThemes.flatMap(theme => {
      const id = normalizeAttributeId(theme.attribute_id);
      return id ? [{ ...theme, attribute_id: id }] : [];
    });

    normThemes.forEach(theme => {
      const attributeId = theme.attribute_id;
      // Prefer the canonical v2 display name; fall back to the LLM's label.
      const attributeName = ATTRIBUTES.find(a => a.id === attributeId)?.name || theme.attribute_name;

      if (!attributeCounts[attributeId]) {
        attributeCounts[attributeId] = {
          count: 0,
          name: attributeName,
          positiveCount: 0,
          negativeCount: 0,
          neutralCount: 0,
          avgSentimentScore: 0
        };
      }

      attributeCounts[attributeId].count++;
      attributeCounts[attributeId][`${theme.sentiment}Count`]++;
    });

    // Calculate average sentiment scores and determine SWOT category
    Object.keys(attributeCounts).forEach(attributeId => {
      const themesForAttribute = normThemes.filter(theme => theme.attribute_id === attributeId);
      const avgSentimentScore = themesForAttribute.reduce((sum, theme) => sum + theme.sentiment_score, 0) / themesForAttribute.length;
      attributeCounts[attributeId].avgSentimentScore = avgSentimentScore;
    });

    // Convert to array and categorize by SWOT.
    // Methodology v2: gates run on the label-based positive/(positive+negative)
    // ratio, not the numeric sentiment_score. Thresholds are the old numeric
    // gates translated onto the 0..1 ratio scale (0.3→0.65, 0.1→0.55, etc.).
    return Object.entries(attributeCounts)
      .map(([attributeId, data]) => {
        const ratio = sentimentRatioV2(data.positiveCount, data.negativeCount);
        let swotCategory: string;
        if (ratio !== null && ratio >= 0.65 && data.count >= 3) {
          swotCategory = 'Strength';
        } else if (ratio !== null && ratio <= 0.35 && data.count >= 2) {
          swotCategory = 'Weakness';
        } else if (ratio !== null && ratio >= 0.55 && data.count >= 2) {
          swotCategory = 'Opportunity';
        } else if (ratio !== null && ratio <= 0.45) {
          swotCategory = 'Threat';
        } else {
          swotCategory = 'Opportunity'; // Default for neutral/no-signal sentiment
        }

        return {
          id: attributeId,
          name: data.name,
          count: data.count,
          positiveCount: data.positiveCount,
          negativeCount: data.negativeCount,
          neutralCount: data.neutralCount,
          avgSentimentScore: data.avgSentimentScore,
          swotCategory,
          trendChange: themeTrends[attributeId] || 0
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 most mentioned
  }, [aiThemes, themeTrends]);

  // Prefer the pre-aggregated MV path; fall back to the raw-themes computation.
  const displayedThemes = (mvAttributeScores && mvAttributeScores.length > 0)
    ? mvAttributeScores
    : mostMentionedThemes;

  const volumeThresholds = useMemo(() => {
    if (displayedThemes.length === 0) return { p20: 0, p40: 0, p60: 0, p80: 0 };
    const sorted = [...displayedThemes.map(t => t.count)].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
      return sorted[idx];
    };
    return { p20: percentile(20), p40: percentile(40), p60: percentile(60), p80: percentile(80) };
  }, [displayedThemes]);

  const getVolumeLabel = (count: number) => {
    if (count > volumeThresholds.p80) return { text: 'Very High', style: 'bg-blue-100 text-blue-700' };
    if (count > volumeThresholds.p60) return { text: 'High', style: 'bg-sky-50 text-sky-700' };
    if (count > volumeThresholds.p40) return { text: 'Medium', style: 'bg-amber-50 text-amber-700' };
    if (count > volumeThresholds.p20) return { text: 'Low', style: 'bg-orange-50 text-orange-700' };
    return { text: 'Very Low', style: 'bg-red-50 text-red-600' };
  };

  const renderAttributeItem = (attribute: any) => {
    const IconComponent = ATTRIBUTE_ICONS[attribute.id] || Target;
    // Methodology v2: neutrals are excluded from the displayed score.
    const sentimentScore = Math.round((sentimentRatioV2(attribute.positiveCount, attribute.negativeCount) ?? 0) * 100);
    const scoreColor = sentimentScore >= 70 ? 'text-green-600' : sentimentScore >= 50 ? 'text-yellow-600' : sentimentScore >= 30 ? 'text-orange-600' : 'text-red-600';

    const volumeLabel = getVolumeLabel(attribute.count);

    return (
      <div className="flex items-center justify-between py-2 hover:bg-gray-50/50 transition-colors rounded-lg px-2">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
            <IconComponent className={`w-4 h-4 ${scoreColor}`} />
          </div>
          <div className="min-w-0 flex items-center space-x-1">
            <span className="text-xs font-medium text-gray-900 truncate max-w-[120px]" title={attribute.name}>
              {attribute.name}
            </span>
            <span className={`text-[9px] font-medium px-1 py-0 rounded whitespace-nowrap ${volumeLabel.style}`}>
              {volumeLabel.text}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-900 w-10 text-right">
            {sentimentScore}%
          </span>
          {previousPeriodResponses.length > 0 && (
            <span className="w-[40px] flex justify-end">
              {(() => {
                const delta = Math.round(attribute.trendChange);
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

  if (displayedThemes.length === 0) {
    return (
      <Card className="shadow-sm border border-gray-200">
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="text-lg font-semibold">Themes</CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {aiThemesLoading ? (
            <div className="space-y-3 py-2">
              {[1,2,3,4,5].map(i => (
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
                <Target className="w-4 h-4 text-gray-400" />
              </div>
              <p className="text-sm">No attribute mentions found yet.</p>
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
          <CardTitle className="text-lg font-semibold">Themes</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/analyze/thematic')}
            className="text-xs"
          >
            View All
            <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <div className="space-y-1">
          {displayedThemes.map((attribute, idx) => (
            <div key={idx}>
              {renderAttributeItem(attribute)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
