import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnalysisResult } from '@/services/AnalysisService';
import { AlertCircle, CheckCircle2, XCircle, Info } from "lucide-react";

interface AnalysisResultsProps {
  analysis: AnalysisResult;
}

export const AnalysisResults: React.FC<AnalysisResultsProps> = ({ analysis }) => {
  const getScoreColor = (score: number) => {
    if (score >= 70) return "bg-green-100 text-green-800";
    if (score >= 40) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getSentimentIcon = (alignment: string) => {
    switch (alignment) {
      case 'aligned':
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'misaligned':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Info className="w-4 h-4 text-blue-600" />;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Analysis Results</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Scores Section */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Consistency Score</span>
                <Badge className={getScoreColor(analysis.consistencyScore)}>
                  {analysis.consistencyScore.toFixed(1)}%
                </Badge>
              </div>
              <p className="text-sm text-gray-600">
                How well the LLM responses match Google search results
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Coverage Score</span>
                <Badge className={getScoreColor(analysis.coverageScore)}>
                  {analysis.coverageScore.toFixed(1)}%
                </Badge>
              </div>
              <p className="text-sm text-gray-600">
                How many Google result topics are covered in LLM responses
              </p>
            </div>
          </div>

          {/* Sentiment Analysis */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">Sentiment Alignment</span>
              <div className="flex items-center gap-2">
                {getSentimentIcon(analysis.sentimentAlignment)}
                <Badge variant="outline">
                  {analysis.sentimentAlignment}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              How well the LLM's sentiment matches the general sentiment in search results
            </p>
          </div>

          {/* Key Findings */}
          <div className="space-y-2">
            <h4 className="font-medium">Key Findings (Common Topics)</h4>
            <div className="flex flex-wrap gap-2">
              {analysis.keyFindings.map((finding, index) => (
                <Badge key={index} variant="outline" className="bg-green-50">
                  {finding}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-gray-600">
              Topics that appear in both Google results and LLM responses
            </p>
          </div>

          {/* Potential Gaps */}
          <div className="space-y-2">
            <h4 className="font-medium">Potential Gaps</h4>
            <div className="flex flex-wrap gap-2">
              {analysis.discrepancies.map((discrepancy, index) => (
                <Badge key={index} variant="outline" className="bg-red-50 text-red-700">
                  {discrepancy}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-gray-600">
              Topics found in Google results but missing from LLM responses
            </p>
          </div>

          {/* Detailed Analysis */}
          <div className="space-y-2">
            <h4 className="font-medium">Detailed Analysis</h4>
            <div className="text-sm space-y-2">
              <p>
                <span className="font-medium">LLM Sentiment Score:</span>{' '}
                {analysis.detailedAnalysis.sentimentDetails.llmSentiment.toFixed(2)}
              </p>
              <p>
                <span className="font-medium">Search Results Sentiment Score:</span>{' '}
                {analysis.detailedAnalysis.sentimentDetails.searchSentiment.toFixed(2)}
              </p>
              <p>
                <span className="font-medium">Total Common Topics:</span>{' '}
                {analysis.detailedAnalysis.commonTopics.length}
              </p>
              <p>
                <span className="font-medium">Total Missing Topics:</span>{' '}
                {analysis.detailedAnalysis.missingTopics.length}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}; 