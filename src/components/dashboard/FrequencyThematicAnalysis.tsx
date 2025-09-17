import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  BarChart3
} from 'lucide-react';
import { ThematicAnalysisService, Theme } from '@/services/thematicAnalysisService';
import { PromptResponse } from '@/types/dashboard';

interface FrequencyThematicAnalysisProps {
  responses: PromptResponse[];
  companyName: string;
}

export const FrequencyThematicAnalysis = ({ responses, companyName }: FrequencyThematicAnalysisProps) => {
  // Perform thematic analysis
  const analysisResult = useMemo(() => {
    if (!responses.length) return null;
    return ThematicAnalysisService.analyzeThemes(responses, companyName);
  }, [responses, companyName]);

  // Separate themes by sentiment and sort by frequency (most important)
  const { positiveThemes, negativeThemes } = useMemo(() => {
    if (!analysisResult) return { positiveThemes: [], negativeThemes: [] };

    const positive = analysisResult.themes
      .filter(theme => theme.sentiment > 0.1)
      .sort((a, b) => b.frequency - a.frequency); // Sort by frequency DESC

    const negative = analysisResult.themes
      .filter(theme => theme.sentiment < -0.1)
      .sort((a, b) => b.frequency - a.frequency); // Sort by frequency DESC

    return { positiveThemes: positive, negativeThemes: negative };
  }, [analysisResult]);

  if (!analysisResult) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Data Available</h3>
              <p className="text-gray-600">
                Thematic analysis requires response data. Please ensure you have responses to analyze.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Theme Analysis</h2>
          <p className="text-gray-600">
            Positive and negative themes about {companyName} ranked by mention count
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">{positiveThemes.length}</p>
            <p className="text-sm text-gray-600">Positive Themes</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-red-600">{negativeThemes.length}</p>
            <p className="text-sm text-gray-600">Negative Themes</p>
          </div>
        </div>
      </div>

      {/* Theme Tabs */}
      <Tabs defaultValue="positive" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="positive" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Positive Themes ({positiveThemes.length})
          </TabsTrigger>
          <TabsTrigger value="negative" className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Negative Themes ({negativeThemes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="positive" className="space-y-3">
          {positiveThemes.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <div className="text-center">
                  <TrendingUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Positive Themes Found</h3>
                  <p className="text-gray-600">
                    No positive themes were identified in the response data.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            positiveThemes.map((theme, index) => (
              <ThemeCard key={theme.id} theme={theme} rank={index + 1} />
            ))
          )}
        </TabsContent>

        <TabsContent value="negative" className="space-y-3">
          {negativeThemes.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <div className="text-center">
                  <TrendingDown className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Negative Themes Found</h3>
                  <p className="text-gray-600">
                    No negative themes were identified in the response data.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            negativeThemes.map((theme, index) => (
              <ThemeCard key={theme.id} theme={theme} rank={index + 1} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

interface ThemeCardProps {
  theme: Theme;
  rank: number;
}

const ThemeCard = ({ theme, rank }: ThemeCardProps) => {
  const getFrequencyBadgeColor = (frequency: number) => {
    if (frequency >= 10) return 'bg-green-100 text-green-800 border-green-200';
    if (frequency >= 5) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (frequency >= 3) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            {/* Rank */}
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-gray-700">#{rank}</span>
              </div>
            </div>

            {/* Theme Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-gray-900 truncate">{theme.name}</h3>
                <Badge variant="outline" className={getFrequencyBadgeColor(theme.frequency)}>
                  {theme.frequency} mentions
                </Badge>
              </div>
              <p className="text-sm text-gray-600 mb-2">{theme.description}</p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="bg-gray-100 px-2 py-1 rounded">
                  {theme.attributeName}
                </span>
                <span className="text-gray-500">
                  {Math.round(theme.confidence * 100)}% confidence
                </span>
              </div>
            </div>

            {/* Frequency (Most Important - Large Display) */}
            <div className="flex-shrink-0 text-right">
              <div className="text-4xl font-bold text-gray-900">{theme.frequency}</div>
              <div className="text-sm text-gray-500">mentions</div>
            </div>
          </div>
        </div>

        {/* Context Examples */}
        {theme.context.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-2">Example mentions:</p>
            <div className="space-y-1">
              {theme.context.slice(0, 2).map((context, index) => (
                <div key={index} className="text-xs text-gray-600 bg-gray-50 p-2 rounded italic">
                  "{context}"
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
