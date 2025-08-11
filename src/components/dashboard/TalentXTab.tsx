import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TalentXAnalysis } from '@/types/talentX';
import { TALENTX_ATTRIBUTES, generatePlaceholderTalentXData, getPromptsByAttribute } from '@/config/talentXAttributes';
import { TalentXPrompts } from './TalentXPrompts';
import { useSubscription } from '@/hooks/useSubscription';
import { TrendingUp, TrendingDown, Minus, Target, Users, Award, BarChart3, Lightbulb, Star, AlertTriangle, CheckCircle, X, MessageSquare, FileText, Copy, ExternalLink } from 'lucide-react';
import { TalentXAnalysisService } from '@/services/talentXAnalysis';
import { UpgradeModal } from '@/components/upgrade/UpgradeModal';

interface TalentXTabProps {
  talentXData: TalentXAnalysis[];
  isProUser: boolean;
  companyName?: string;
  industry?: string;
}

export const TalentXTab = ({ talentXData, isProUser, companyName = 'Your Company', industry = 'Technology' }: TalentXTabProps) => {
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAttributeForModal, setSelectedAttributeForModal] = useState<TalentXAnalysis | null>(null);
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState('overview');

  // Fallback to placeholder data if none is provided
  const displayData = talentXData?.length > 0 ? talentXData : generatePlaceholderTalentXData(companyName);

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    if (!displayData.length) return null;

    const totalAttributes = displayData.length;
    const avgPerception = displayData.reduce((sum, item) => sum + (item.perceptionScore || 0), 0) / totalAttributes;
    const totalMentions = displayData.reduce((sum, item) => sum + item.totalMentions, 0);
    
    const highPerforming = displayData.filter(item => (item.perceptionScore || 0) >= 75).length;
    const needsImprovement = displayData.filter(item => (item.perceptionScore || 0) < 50).length;
    const moderate = displayData.filter(item => (item.perceptionScore || 0) >= 50 && (item.perceptionScore || 0) < 75).length;

    return {
      totalAttributes,
      avgPerception,
      totalMentions,
      highPerforming,
      needsImprovement,
      moderate
    };
  }, [displayData]);

  // Get actionable insights
  const actionableInsights = useMemo(() => {
    return TalentXAnalysisService.getActionableInsights(displayData);
  }, [displayData]);

  // Get categories for filtering
  const categories = useMemo(() => {
    const categorySet = new Set(TALENTX_ATTRIBUTES.map(attr => attr.category));
    return Array.from(categorySet);
  }, []);

  // Filter data by category
  const filteredData = useMemo(() => {
    if (selectedCategory === 'all') return displayData;
    
    return displayData.filter(analysis => {
      const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === analysis.attributeId);
      return attribute?.category === selectedCategory;
    });
  }, [displayData, selectedCategory]);

  // Categorize attributes by performance using perception scores
  const attributeCategories = useMemo(() => {
    const highPerforming = displayData.filter(item => (item.perceptionScore || 0) >= 75);
    const needsImprovement = displayData.filter(item => (item.perceptionScore || 0) < 50);
    const moderate = displayData.filter(item => (item.perceptionScore || 0) >= 50 && (item.perceptionScore || 0) < 75);

    return { highPerforming, needsImprovement, moderate };
  }, [displayData]);

  const getPerceptionColor = (score: number) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPerceptionLabel = (score: number) => {
    if (score >= 75) return 'Excellent';
    if (score >= 50) return 'Good';
    return 'Needs Improvement';
  };

  const getPerformanceIcon = (analysis: TalentXAnalysis) => {
    const perceptionScore = analysis.perceptionScore || 0;
    if (perceptionScore >= 75) {
      return <Star className="w-4 h-4 text-green-600" />;
    } else if (perceptionScore < 50) {
      return <AlertTriangle className="w-4 h-4 text-red-600" />;
    } else {
      return <CheckCircle className="w-4 h-4 text-yellow-600" />;
    }
  };

  const handleAttributeClick = (analysis: TalentXAnalysis) => {
    setSelectedAttributeForModal(analysis);
    setActiveModalTab('overview');
    setIsContextModalOpen(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getPromptsForAttribute = (attributeId: string) => {
    return getPromptsByAttribute(companyName, industry, attributeId);
  };

  const renderAttributeCard = (analysis: TalentXAnalysis, showDetails: boolean = true) => {
    const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === analysis.attributeId);
    if (!attribute) return null;

    return (
      <Card 
        key={analysis.attributeId} 
        className="mb-4 hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => handleAttributeClick(analysis)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getPerformanceIcon(analysis)}
              <CardTitle className="text-lg">{attribute.name}</CardTitle>
              <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                {analysis.perceptionScore || 0}
              </Badge>
            </div>
          </div>
          <p className="text-sm text-gray-600">{attribute.description}</p>
        </CardHeader>
        {showDetails && (
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Perception Score</span>
                  <span className={`font-semibold ${getPerceptionColor(analysis.perceptionScore || 0)}`}>
                    {analysis.perceptionScore || 0} - {getPerceptionLabel(analysis.perceptionScore || 0)}
                  </span>
                </div>
                <Progress value={analysis.perceptionScore || 0} className="h-2 bg-blue-100" />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="font-medium text-gray-700">Total Responses</p>
                  <p className="text-lg font-bold">{analysis.totalResponses || 0}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="font-medium text-gray-700">Avg Sentiment</p>
                  <p className="text-lg font-bold">{Math.round((analysis.avgSentimentScore || 0) * 100)}%</p>
                </div>
              </div>

              {analysis.context && analysis.context.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2 text-blue-600">Click to view details →</p>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    );
  };

  const renderPerformanceOverview = () => {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* High Performing */}
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-green-800">
              <Star className="w-5 h-5" />
              High Performing ({attributeCategories.highPerforming.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attributeCategories.highPerforming.length > 0 ? (
              <div className="space-y-3">
                {attributeCategories.highPerforming.slice(0, 3).map((analysis, index) => 
                  <div key={index}>{renderAttributeCard(analysis, false)}</div>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">No high-performing attributes yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Moderate */}
        <Card className="border-yellow-200 bg-yellow-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-yellow-800">
              <CheckCircle className="w-5 h-5" />
              Moderate ({attributeCategories.moderate.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attributeCategories.moderate.length > 0 ? (
              <div className="space-y-3">
                {attributeCategories.moderate.slice(0, 3).map((analysis, index) => 
                  <div key={index}>{renderAttributeCard(analysis, false)}</div>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">No moderate attributes yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Needs Improvement */}
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-800">
              <AlertTriangle className="w-5 h-5" />
              Needs Improvement ({attributeCategories.needsImprovement.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attributeCategories.needsImprovement.length > 0 ? (
              <div className="space-y-3">
                {attributeCategories.needsImprovement.slice(0, 3).map((analysis, index) => 
                  <div key={index}>{renderAttributeCard(analysis, false)}</div>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">No attributes need improvement.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  if (!isProUser) {
    return (
      <div className="relative min-h-[600px]">
        {/* Overlay for Coming Soon */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
          <div className="text-center p-8 max-w-lg mx-auto">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">TalentX Attributes (Coming Soon)</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              This feature will provide detailed analysis of how your company performs across key talent attraction attributes. 
              Get insights into mission & purpose, company culture, rewards & recognition, and more to improve your employer brand.
            </p>
            <span className="inline-block bg-yellow-400 text-yellow-900 px-4 py-2 rounded-full font-semibold text-sm">Coming Soon</span>
          </div>
        </div>
        {/* Blurred/disabled content underneath */}
        <div className="blur-sm pointer-events-none select-none opacity-60">
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="bg-gradient-to-r from-blue-500 to-purple-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Award className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">TalentX Attributes Analysis</h3>
              <p className="text-gray-600 mb-6">
                Unlock detailed analysis of how your company performs across key talent attraction attributes. 
                Get insights into mission & purpose, company culture, rewards & recognition, and more.
              </p>
              <Badge variant="secondary" className="bg-primary/10 text-primary px-4 py-2">
                Pro Feature
              </Badge>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderPerformanceOverview()}

      {/* Attributes Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            All Attributes Analysis
          </CardTitle>
          <p className="text-sm text-gray-600">
            Detailed breakdown of all talent attraction attributes with scores, sentiment, and competitive analysis
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attribute</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead className="text-center">Sentiment</TableHead>
                <TableHead className="text-center">Competitive</TableHead>
                <TableHead className="text-center">Visibility</TableHead>
                <TableHead>Popular Themes</TableHead>
                <TableHead className="text-center">Responses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayData.map((analysis, index) => {
                const attribute = TALENTX_ATTRIBUTES.find(attr => attr.id === analysis.attributeId);
                const competitiveScore = analysis.competitiveAnalyses?.length > 0 
                  ? Math.round((analysis.competitiveAnalyses[0]?.competitive_score || analysis.competitiveAnalyses[0]?.perception_score || 0))
                  : 0;
                const visibilityScore = analysis.visibilityAnalyses?.length > 0 
                  ? Math.round((analysis.visibilityAnalyses[0]?.visibility_score || analysis.visibilityAnalyses[0]?.perception_score || 0))
                  : 0;
                const popularThemes = analysis.context?.slice(0, 2) || [];
                
                return (
                  <TableRow 
                    key={index}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleAttributeClick(analysis)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {getPerformanceIcon(analysis)}
                        <div>
                          <div className="font-semibold">{attribute?.name || analysis.attributeName}</div>
                          <div className="text-sm text-gray-500">{attribute?.category || 'General'}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        variant="outline" 
                        className={`${
                          (analysis.perceptionScore || 0) >= 75 
                            ? 'bg-green-50 text-green-700 border-green-200' 
                            : (analysis.perceptionScore || 0) >= 50 
                            ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                      >
                        {analysis.perceptionScore || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className={`text-sm font-medium ${
                          (analysis.avgSentimentScore || 0) > 0.1 
                            ? 'text-green-600' 
                            : (analysis.avgSentimentScore || 0) < -0.1 
                            ? 'text-red-600' 
                            : 'text-gray-600'
                        }`}>
                          {Math.round((analysis.avgSentimentScore || 0) * 100)}%
                        </span>
                        {(analysis.avgSentimentScore || 0) > 0.1 ? (
                          <TrendingUp className="w-3 h-3 text-green-600" />
                        ) : (analysis.avgSentimentScore || 0) < -0.1 ? (
                          <TrendingDown className="w-3 h-3 text-red-600" />
                        ) : (
                          <Minus className="w-3 h-3 text-gray-600" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                        {competitiveScore}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="bg-purple-50 text-purple-700">
                        {visibilityScore}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {popularThemes.length > 0 ? (
                          popularThemes.map((theme, idx) => (
                            <div key={idx} className="text-xs text-gray-600 truncate max-w-[200px]" title={theme}>
                              "{theme.substring(0, 50)}..."
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">No themes available</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="bg-gray-50">
                        {analysis.totalResponses || 0}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Enhanced Context Modal */}
      <Dialog open={isContextModalOpen} onOpenChange={setIsContextModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {selectedAttributeForModal && TALENTX_ATTRIBUTES.find(attr => attr.id === selectedAttributeForModal.attributeId)?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedAttributeForModal && (
            <div className="space-y-6">
              {/* Attribute Overview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-600">Perception Score</p>
                  <p className={`text-2xl font-bold ${getPerceptionColor(selectedAttributeForModal.perceptionScore || 0)}`}>
                    {selectedAttributeForModal.perceptionScore || 0}
                  </p>
                  <p className="text-sm text-gray-600">{getPerceptionLabel(selectedAttributeForModal.perceptionScore || 0)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Responses</p>
                  <p className="text-2xl font-bold">{selectedAttributeForModal.totalResponses || 0}</p>
                  <p className="text-sm text-gray-600">Analyzed responses</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Avg Sentiment</p>
                  <p className="text-2xl font-bold">{Math.round((selectedAttributeForModal.avgSentimentScore || 0) * 100)}%</p>
                  <p className="text-sm text-gray-600">Positive sentiment</p>
                </div>
              </div>

              {/* Modal Tabs */}
              <Tabs value={activeModalTab} onValueChange={setActiveModalTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="responses">Response Snippets</TabsTrigger>
                  <TabsTrigger value="prompts">Prompts Used</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" />
                      Analysis Summary
                    </h4>
                    <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-400">
                      <p className="text-sm text-gray-700">
                        {TALENTX_ATTRIBUTES.find(attr => attr.id === selectedAttributeForModal.attributeId)?.description}
                      </p>
                    </div>
                  </div>

                  {selectedAttributeForModal.context && selectedAttributeForModal.context.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        Key Insights
                      </h4>
                      <div className="space-y-3">
                        {selectedAttributeForModal.context.slice(0, 3).map((ctx, idx) => (
                          <div key={idx} className="p-4 bg-gray-50 rounded-lg border-l-4 border-blue-200">
                            <p className="text-sm text-gray-700">"{ctx}..."</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="responses" className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Response Snippets Mentioning This Attribute
                    </h4>
                    {selectedAttributeForModal.context && selectedAttributeForModal.context.length > 0 ? (
                      <div className="space-y-4">
                        {selectedAttributeForModal.context.map((snippet, idx) => (
                          <Card key={idx} className="border-l-4 border-blue-200">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <p className="text-sm text-gray-700 mb-2">"{snippet}..."</p>
                                  <div className="flex items-center gap-4 text-xs text-gray-500">
                                    <span>Snippet {idx + 1}</span>
                                    <span>•</span>
                                    <span>AI Response</span>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(snippet)}
                                  className="ml-2"
                                >
                                  <Copy className="w-4 h-4" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No response snippets available for this attribute.</p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="prompts" className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Prompts Used for This Attribute
                    </h4>
                    {(() => {
                      const prompts = getPromptsForAttribute(selectedAttributeForModal.attributeId);
                      return prompts.length > 0 ? (
                        <div className="space-y-4">
                          {prompts.map((prompt, idx) => (
                            <Card key={idx} className="border-l-4 border-green-200">
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Badge variant="outline" className="text-xs">
                                        {prompt.type}
                                      </Badge>
                                      <span className="text-xs text-gray-500">Prompt {idx + 1}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 mb-2">{prompt.prompt}</p>
                                    <div className="flex items-center gap-4 text-xs text-gray-500">
                                      <span>Category: {prompt.attribute?.category}</span>
                                      <span>•</span>
                                      <span>Pro Only: {prompt.attribute?.isProOnly ? 'Yes' : 'No'}</span>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyToClipboard(prompt.prompt)}
                                    className="ml-2"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p>No prompts available for this attribute.</p>
                        </div>
                      );
                    })()}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}; 