import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink, X, Lightbulb, Building2 } from "lucide-react";
import LLMLogo from "@/components/LLMLogo";
import { PromptResponse } from "@/types/dashboard";

interface ResponseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptText: string;
  responses: PromptResponse[];
}

export const ResponseDetailsModal = ({ 
  isOpen, 
  onClose, 
  promptText, 
  responses 
}: ResponseDetailsModalProps) => {
  const [selectedResponse, setSelectedResponse] = useState<PromptResponse | null>(
    responses.length > 0 ? responses[0] : null
  );

  // Add debugging and validation
  useEffect(() => {
    if (isOpen) {
      console.log('Modal opened with:');
      console.log('Prompt Text:', promptText);
      console.log('Responses:', responses);
      console.log('Responses count:', responses.length);
      
      // Validate that all responses match the prompt text
      const mismatchedResponses = responses.filter(r => 
        r.confirmed_prompts?.prompt_text !== promptText
      );
      
      if (mismatchedResponses.length > 0) {
        console.error('MISMATCH DETECTED! These responses do not match the prompt:');
        mismatchedResponses.forEach(r => {
          console.error('Response ID:', r.id);
          console.error('Response prompt text:', r.confirmed_prompts?.prompt_text);
          console.error('Expected prompt text:', promptText);
        });
      } else {
        console.log('✅ All responses correctly match the prompt text');
      }
    }
  }, [isOpen, promptText, responses]);

  // Update selected response when responses change
  useEffect(() => {
    if (responses.length > 0) {
      setSelectedResponse(responses[0]);
    } else {
      setSelectedResponse(null);
    }
  }, [responses]);

  const getSentimentColor = (score: number | null) => {
    if (!score) return "text-gray-500";
    if (score > 0.1) return "text-green-600";
    if (score < -0.1) return "text-red-600";
    return "text-gray-600";
  };

  const getSentimentBadge = (score: number | null, label: string | null) => {
    if (!score) return "No sentiment";
    const percentage = Math.abs(score * 100).toFixed(0);
    return `${percentage}% ${label || 'Neutral'}`;
  };

  const getVisibilityScore = (response: PromptResponse) => {
    return response.company_mentioned ? "100%" : "0%";
  };

  const getBrandPerception = (response: PromptResponse) => {
    return response.company_mentioned ? "Mentioned" : "Not Mentioned";
  };

  const analyzeResponses = () => {
    if (responses.length === 0) return [];

    const insights = [];

    // Analyze sentiment consistency
    const sentimentScores = responses.map(r => r.sentiment_score).filter(Boolean);
    if (sentimentScores.length > 0) {
      const avgSentiment = sentimentScores.reduce((a, b) => a + b!, 0) / sentimentScores.length;
      const sentimentRange = Math.max(...sentimentScores) - Math.min(...sentimentScores);
      
      if (sentimentRange > 0.3) {
        insights.push("High sentiment variation across models - consider standardizing messaging");
      } else if (avgSentiment > 0.1) {
        insights.push("Consistently positive sentiment across all models");
      } else if (avgSentiment < -0.1) {
        insights.push("Consistently negative sentiment across all models - may need attention");
      }
    }

    // Analyze company visibility
    const visibilityScores = responses.map(r => {
      if (!r.company_mentioned || !r.first_mention_position || !r.total_words) return 0;
      return (1 - (r.first_mention_position / r.total_words)) * 100;
    });
    
    const avgVisibility = visibilityScores.reduce((a, b) => a + b, 0) / visibilityScores.length;
    if (avgVisibility < 30) {
      insights.push("Low company visibility in responses - consider improving brand positioning");
    } else if (avgVisibility > 70) {
      insights.push("Strong company visibility across all models");
    }

    // Analyze response consistency
    const responseLengths = responses.map(r => r.response_text.length);
    const avgLength = responseLengths.reduce((a, b) => a + b, 0) / responseLengths.length;
    const lengthVariation = Math.max(...responseLengths) - Math.min(...responseLengths);
    
    if (lengthVariation > avgLength * 0.5) {
      insights.push("High variation in response lengths - consider standardizing content depth");
    }

    // Analyze competitor mentions
    const competitorMentions = responses.filter(r => r.competitor_mentions).length;
    if (competitorMentions > 0) {
      insights.push(`${competitorMentions} models mentioned competitors - review competitive positioning`);
    }

    return insights;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-lg font-semibold mb-2">
                {promptText}
              </DialogTitle>
              <p className="text-sm text-gray-500">
                Generated {responses.length > 0 ? new Date(responses[0].tested_at).toLocaleDateString() : 'recently'}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
          {/* Left Panel - Response List */}
          <ScrollArea className="h-full">
            <div className="space-y-3 pr-4">
              <h3 className="font-medium text-sm text-gray-700 mb-3">Responses ({responses.length})</h3>
              {responses.map((response) => (
                <div
                  key={response.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedResponse?.id === response.id 
                      ? 'bg-blue-50 border-blue-200' 
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                  onClick={() => setSelectedResponse(response)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <LLMLogo modelName={response.ai_model} size="sm" />
                      <span className="text-sm font-medium">{response.ai_model}</span>
                    </div>
                    <span className={`text-xs font-medium ${getSentimentColor(response.sentiment_score)}`}>
                      {getSentimentBadge(response.sentiment_score, response.sentiment_label)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2">
                    {response.response_text.substring(0, 100)}...
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Right Panel - Selected Response Details */}
          <ScrollArea className="col-span-2 h-full">
            {selectedResponse && (
              <div className="space-y-6 pr-4">
                {/* Metrics Row */}
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Provider</p>
                    <div className="flex items-center space-x-2">
                      <LLMLogo modelName={selectedResponse.ai_model} size="sm" />
                      <span className="text-sm font-medium">{selectedResponse.ai_model.split('-')[0]}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Model</p>
                    <p className="text-sm font-medium">{selectedResponse.ai_model}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Sentiment</p>
                    <p className={`text-sm font-medium ${getSentimentColor(selectedResponse.sentiment_score)}`}>
                      {selectedResponse.sentiment_label || 'Neutral'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Visibility Score</p>
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                        <span className="text-xs font-medium text-orange-600">
                          {getVisibilityScore(selectedResponse)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Key Insights Summary */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <Lightbulb className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-medium text-blue-900">Key Insights Summary</h3>
                  </div>
                  <div className="space-y-2">
                    {analyzeResponses().map((insight, index) => (
                      <div key={index} className="flex items-start space-x-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5"></div>
                        <p className="text-sm text-blue-800">{insight}</p>
                      </div>
                    ))}
                    {analyzeResponses().length === 0 && (
                      <p className="text-sm text-blue-800">No significant insights to report</p>
                    )}
                  </div>
                </div>

                {/* Workplace Themes */}
                {selectedResponse.workplace_themes && selectedResponse.workplace_themes.length > 0 && (
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <Building2 className="w-4 h-4 text-green-600" />
                      <h3 className="text-sm font-medium text-green-900">Workplace Themes</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {selectedResponse.workplace_themes.map((theme, index) => (
                        <div key={index} className="bg-white rounded-lg p-3 border border-green-100">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-green-800">{theme.name}</span>
                            <Badge variant="outline" className={`text-xs ${
                              theme.confidence === 'high' ? 'bg-green-100 text-green-800' :
                              theme.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {theme.confidence}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-600 mb-2">{theme.context}</p>
                          <div className={`text-xs px-2 py-1 rounded-full inline-block ${
                            theme.sentiment === 'positive' ? 'bg-green-100 text-green-800' :
                            theme.sentiment === 'negative' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {theme.sentiment}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Brand Perception</p>
                    <p className="text-sm font-medium">{getBrandPerception(selectedResponse)}</p>
                  </div>
                </div>

                <Separator />

                {/* User Prompt */}
                <div>
                  <div className="flex items-center space-x-2 mb-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <p className="text-sm font-medium text-blue-600">User prompt</p>
                    <ExternalLink className="w-3 h-3 text-blue-600" />
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-800">{promptText}</p>
                  </div>
                </div>

                {/* AI Response */}
                <div>
                  <div className="flex items-center space-x-2 mb-3">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <p className="text-sm font-medium text-purple-600">AI Response</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {selectedResponse.response_text}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
