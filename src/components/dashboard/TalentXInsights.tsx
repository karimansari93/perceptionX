import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TalentXAnalysis } from '@/types/talentX';
import { TALENTX_ATTRIBUTES } from '@/config/talentXAttributes';
import { useSubscription } from '@/hooks/useSubscription';
import { TrendingUp, TrendingDown, Minus, Award, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface TalentXInsightsProps {
  talentXData: TalentXAnalysis[];
  companyName: string;
}

export const TalentXInsights = ({ talentXData, companyName }: TalentXInsightsProps) => {
  const { isPro } = useSubscription();
  const navigate = useNavigate();

  // Calculate summary metrics
  const summaryMetrics = React.useMemo(() => {
    if (!talentXData.length) return null;

    const totalAttributes = talentXData.length;
    const avgPerception = talentXData.reduce((sum, item) => sum + item.perceptionScore, 0) / totalAttributes;
    const avgSentiment = talentXData.reduce((sum, item) => sum + item.avgSentimentScore, 0) / totalAttributes;
    
    const positiveAttributes = talentXData.filter(item => item.avgSentimentScore > 0.2).length;
    const neutralAttributes = talentXData.filter(item => item.avgSentimentScore >= -0.2 && item.avgSentimentScore <= 0.2).length;
    const negativeAttributes = talentXData.filter(item => item.avgSentimentScore < -0.2).length;

    return {
      totalAttributes,
      avgPerception,
      avgSentiment,
      positiveAttributes,
      neutralAttributes,
      negativeAttributes
    };
  }, [talentXData]);

  const getSentimentIcon = (score: number) => {
    if (score >= 0.3) return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (score >= -0.3) return <Minus className="w-4 h-4 text-yellow-600" />;
    return <TrendingDown className="w-4 h-4 text-red-600" />;
  };

  const getSentimentColor = (score: number) => {
    if (score >= 0.3) return 'text-green-600';
    if (score >= -0.3) return 'text-yellow-600';
    return 'text-red-600';
  };

  const handleViewFullAnalysis = () => {
    // Navigate to TalentX tab
    navigate('/dashboard?tab=talentx');
  };

  if (!isPro) {
    return (
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-blue-600" />
              TalentX Attributes
            </CardTitle>
            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
              Pro Feature
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-4">
            Unlock detailed analysis of how {companyName} performs across key talent attraction attributes.
          </p>
          <Button 
            variant="outline" 
            size="sm"
            className="w-full"
            onClick={handleViewFullAnalysis}
          >
            Upgrade to Pro
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!talentXData.length) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Award className="w-5 h-5 text-gray-600" />
            TalentX Attributes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-4">
            TalentX analysis will appear here once you have responses that contain relevant talent attraction attributes.
          </p>
          <Button 
            variant="outline" 
            size="sm"
            className="w-full"
            onClick={handleViewFullAnalysis}
          >
            View Full Analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  const topAttributes = talentXData.slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600" />
            TalentX Attributes
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleViewFullAnalysis}
            className="text-blue-600 hover:text-blue-700"
          >
            View Full Analysis
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{summaryMetrics?.totalAttributes}</p>
            <p className="text-sm text-gray-600">Attributes Analyzed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">
              {summaryMetrics?.avgPerception ? Math.round(summaryMetrics.avgPerception) : 0}
            </p>
            <p className="text-sm text-gray-600">Avg Perception</p>
          </div>
        </div>

        {/* Top Attributes */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">Top Attributes</p>
          <div className="space-y-3">
            {topAttributes.map((analysis) => {
              const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === analysis.attributeId);
              if (!attribute) return null;

              return (
                <div key={analysis.attributeId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    {getSentimentIcon(analysis.avgSentimentScore)}
                    <div>
                      <p className="font-medium text-sm">{attribute.name}</p>
                      <p className="text-xs text-gray-600">{Math.round(analysis.perceptionScore)}% perception</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${getSentimentColor(analysis.avgSentimentScore)}`}>
                      {analysis.avgSentimentScore > 0 ? '+' : ''}{Math.round(analysis.avgSentimentScore * 100)}%
                    </p>
                    <Progress 
                      value={analysis.perceptionScore} 
                      className="w-16 h-1 mt-1" 
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sentiment Breakdown */}
        {summaryMetrics && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Sentiment Breakdown</p>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <span className="text-green-600 font-medium">{summaryMetrics.positiveAttributes}</span>
                <span className="text-gray-600">Positive</span>
              </div>
              <div className="flex items-center gap-1">
                <Minus className="w-4 h-4 text-yellow-600" />
                <span className="text-yellow-600 font-medium">{summaryMetrics.neutralAttributes}</span>
                <span className="text-gray-600">Neutral</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown className="w-4 h-4 text-red-600" />
                <span className="text-red-600 font-medium">{summaryMetrics.negativeAttributes}</span>
                <span className="text-gray-600">Negative</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}; 