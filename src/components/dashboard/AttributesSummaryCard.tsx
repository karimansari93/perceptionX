import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ExternalLink, Target, Award, Users, Heart, Shield, Lightbulb, Coffee, Crown, Lock } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { TALENTX_ATTRIBUTES } from "@/config/talentXAttributes";

interface AttributesSummaryCardProps {
  talentXProData?: any[];
  aiThemes?: any[];
  companyName?: string;
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
  companyName 
}: AttributesSummaryCardProps) => {
  const navigate = useNavigate();

  // Calculate most mentioned attributes from AI themes with SWOT categorization
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
          swotCategory
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 most mentioned
  }, [aiThemes]);

  const renderAttributeItem = (attribute: any) => {
    const IconComponent = ATTRIBUTE_ICONS[attribute.id] || Target;
    
    // Determine color and variant based on SWOT category
    const getSWOTStyling = (swotCategory: string) => {
      switch (swotCategory) {
        case 'Strength':
          return { colors: 'text-green-700 bg-green-50 border-green-200' };
        case 'Weakness':
          return { colors: 'text-red-700 bg-red-50 border-red-200' };
        case 'Opportunity':
          return { colors: 'text-blue-700 bg-blue-50 border-blue-200' };
        case 'Threat':
          return { colors: 'text-orange-700 bg-orange-50 border-orange-200' };
        default:
          return { colors: 'text-gray-700 bg-gray-50 border-gray-200' };
      }
    };
    
    const styling = getSWOTStyling(attribute.swotCategory);
    
    return (
      <div className="flex items-center justify-between py-2 hover:bg-gray-50/50 transition-colors rounded-lg px-2">
        {/* Attribute icon and name */}
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
            <IconComponent className={`w-4 h-4 ${styling.colors.split(' ')[0]}`} />
          </div>
          <div className="min-w-0 flex items-center space-x-1">
            <span className="text-xs font-medium text-gray-900 truncate" title={attribute.name}>
              {attribute.name}
            </span>
            <Badge className={`text-xs px-1 py-0 h-4 ${styling.colors}`}>
              {attribute.swotCategory}
            </Badge>
          </div>
        </div>
        
        {/* Count */}
        <div className="flex items-center min-w-[30px] justify-end">
          <span className="text-xs font-semibold text-gray-900">
            {attribute.count}
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
          <div className="text-center py-8 text-gray-500">
            <div className="w-8 h-8 mx-auto mb-2 bg-gray-100 rounded-full flex items-center justify-center">
              <Target className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-sm">No attribute mentions found yet.</p>
          </div>
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
