import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ExternalLink, Target, Award, Users, Heart, Shield, Lightbulb, Coffee, Crown, Lock } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { TALENTX_ATTRIBUTES } from "@/config/talentXAttributes";

interface AttributesSummaryCardProps {
  talentXProData?: any[];
  aiThemes?: any[];
  companyName?: string;
  perceptionScoreTrend?: any[];
  previousPeriodResponses?: any[];
  responses?: any[];
  aiThemesLoading?: boolean;
}

// Attribute icon mapping (shared with KeyTakeaways)
const ATTRIBUTE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'mission-purpose': Target,
  'rewards-recognition': Award,
  'company-culture': Users,
  'social-impact': Heart,
  'inclusion': Shield,
  'innovation': Lightbulb,
  'wellbeing-balance': Coffee,
  'leadership': Crown,
  'security-perks': Lock,
  'career-opportunities': TrendingUp
};

export const AttributesSummaryCard = ({ 
  talentXProData = [], 
  aiThemes = [], 
  companyName,
  perceptionScoreTrend = [],
  previousPeriodResponses = [],
  responses = [],
  aiThemesLoading = false
}: AttributesSummaryCardProps) => {
  const navigate = useNavigate();

  // Calculate theme trends: share of mentions % (current period) - share of mentions % (previous period)
  const themeTrends = useMemo(() => {
    if (previousPeriodResponses.length === 0 || aiThemesLoading) return {};

    const currentResponseIds = new Set(responses.map((r: any) => r.id));
    const prevResponseIds = new Set(previousPeriodResponses.map((r: any) => r.id));

    const currentThemes = aiThemes.filter(t => currentResponseIds.has(t.response_id));
    const prevThemes = aiThemes.filter(t => prevResponseIds.has(t.response_id));

    // Count mentions per attribute
    const countByAttr = (themes: any[]) => {
      const c: Record<string, number> = {};
      themes.forEach(t => { c[t.talentx_attribute_id] = (c[t.talentx_attribute_id] || 0) + 1; });
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

    aiThemes.forEach(theme => {
      const attributeId = theme.talentx_attribute_id;
      const attributeName = theme.talentx_attribute_name;
      
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
      const themesForAttribute = aiThemes.filter(theme => theme.talentx_attribute_id === attributeId);
      const avgSentimentScore = themesForAttribute.reduce((sum, theme) => sum + theme.sentiment_score, 0) / themesForAttribute.length;
      attributeCounts[attributeId].avgSentimentScore = avgSentimentScore;
    });

    // Convert to array and categorize by SWOT
    return Object.entries(attributeCounts)
      .map(([attributeId, data]) => {
        // Determine SWOT category based on sentiment and mention count
        let swotCategory: string;
        if (data.avgSentimentScore > 0.3 && data.count >= 3) {
          swotCategory = 'Strength';
        } else if (data.avgSentimentScore < -0.3 && data.count >= 2) {
          swotCategory = 'Weakness';
        } else if (data.avgSentimentScore > 0.1 && data.count >= 2) {
          swotCategory = 'Opportunity';
        } else if (data.avgSentimentScore < -0.1) {
          swotCategory = 'Threat';
        } else {
          swotCategory = 'Opportunity'; // Default for neutral/low sentiment
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

  const volumeThresholds = useMemo(() => {
    if (mostMentionedThemes.length === 0) return { p20: 0, p40: 0, p60: 0, p80: 0 };
    const sorted = [...mostMentionedThemes.map(t => t.count)].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
      return sorted[idx];
    };
    return { p20: percentile(20), p40: percentile(40), p60: percentile(60), p80: percentile(80) };
  }, [mostMentionedThemes]);

  const getVolumeLabel = (count: number) => {
    if (count > volumeThresholds.p80) return { text: 'Very High', style: 'bg-blue-100 text-blue-700' };
    if (count > volumeThresholds.p60) return { text: 'High', style: 'bg-sky-50 text-sky-700' };
    if (count > volumeThresholds.p40) return { text: 'Medium', style: 'bg-amber-50 text-amber-700' };
    if (count > volumeThresholds.p20) return { text: 'Low', style: 'bg-orange-50 text-orange-700' };
    return { text: 'Very Low', style: 'bg-red-50 text-red-600' };
  };

  const renderAttributeItem = (attribute: any) => {
    const IconComponent = ATTRIBUTE_ICONS[attribute.id] || Target;
    const total = attribute.positiveCount + attribute.negativeCount + attribute.neutralCount;
    const sentimentScore = total > 0 ? Math.round((attribute.positiveCount / total) * 100) : 0;
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
        
        <div className="flex items-center gap-1 min-w-[40px] justify-end">
          <span className="text-xs font-semibold text-gray-900">
            {sentimentScore}%
          </span>
          <span className="w-[40px] flex justify-end">
            {(() => {
              const delta = Math.round(attribute.trendChange);
              if (delta === 0) return previousPeriodResponses.length > 0 ? <span className="text-xs text-gray-400">-</span> : null;
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

  if (mostMentionedThemes.length === 0) {
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
          {mostMentionedThemes.map((attribute, idx) => (
            <div key={idx}>
              {renderAttributeItem(attribute)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
