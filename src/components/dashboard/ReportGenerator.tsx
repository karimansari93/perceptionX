import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Download, Calendar, BarChart3, Loader2 } from 'lucide-react';
import { useReportGeneration } from '@/hooks/useReportGeneration';
import { PromptResponse, DashboardMetrics, SentimentTrendData, CitationCount, PromptData } from '@/types/dashboard';

interface ReportGeneratorProps {
  companyName: string;
  metrics: DashboardMetrics;
  responses: PromptResponse[];
  sentimentTrend: SentimentTrendData[];
  topCitations: CitationCount[];
  promptsData: PromptData[];
  answerGapsData?: {
    contentScore: number;
    actionableTasks: any[];
    websiteMetadata: any;
  };
}

export const ReportGenerator = ({
  companyName,
  metrics,
  responses,
  sentimentTrend,
  topCitations,
  promptsData,
  answerGapsData
}: ReportGeneratorProps) => {
  const [selectedReportType, setSelectedReportType] = useState<'complete' | 'answer-gaps'>('complete');
  const [includeCharts, setIncludeCharts] = useState(true);
  const { generateReport, isGenerating } = useReportGeneration();

  const handleGenerateReport = async () => {
    const reportData = {
      companyName,
      metrics,
      responses,
      sentimentTrend,
      topCitations,
      promptsData,
      answerGaps: answerGapsData
    };

    const options = {
      type: selectedReportType,
      includeCharts
    };

    await generateReport(reportData, options);
  };

  const getReportDescription = (type: 'complete' | 'answer-gaps') => {
    if (type === 'complete') {
      return 'Comprehensive report including all dashboard metrics, prompt performance, sentiment analysis, and citation data';
    }
    return 'Focused report on website content gaps, actionable tasks, and improvement recommendations';
  };

  return (
    <div className="relative">
      {/* Overlay for Coming Soon */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm" style={{ pointerEvents: 'all' }}>
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold mb-2 text-gray-800">Reports (Coming Soon)</h2>
          <p className="text-gray-600 max-w-md mx-auto mb-4">
            This feature will allow you to generate comprehensive PDF reports of your AI perception, prompt performance, and answer gaps for sharing with stakeholders.
          </p>
          <span className="inline-block bg-gray-200 text-gray-700 px-3 py-1 rounded-full font-semibold text-sm">Coming Soon</span>
        </div>
      </div>
      {/* Blurred/disabled content underneath */}
      <div className="blur-sm pointer-events-none select-none opacity-60">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Generate Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Report Type Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Report Type</Label>
              <div className="grid gap-3">
                <div 
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    selectedReportType === 'complete' 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedReportType('complete')}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={selectedReportType === 'complete'}
                        onChange={() => setSelectedReportType('complete')}
                        className="w-4 h-4"
                      />
                      <span className="font-medium">Complete Dashboard Report</span>
                    </div>
                    <Badge variant="outline">
                      <BarChart3 className="w-3 h-3 mr-1" />
                      Full Analysis
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">
                    {getReportDescription('complete')}
                  </p>
                </div>

                <div 
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    selectedReportType === 'answer-gaps' 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedReportType('answer-gaps')}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={selectedReportType === 'answer-gaps'}
                        onChange={() => setSelectedReportType('answer-gaps')}
                        className="w-4 h-4"
                        disabled={!answerGapsData}
                      />
                      <span className={`font-medium ${!answerGapsData ? 'text-gray-400' : ''}`}>
                        Answer Gaps Report
                      </span>
                    </div>
                    <Badge variant="outline">
                      <FileText className="w-3 h-3 mr-1" />
                      Content Focus
                    </Badge>
                  </div>
                  <p className={`text-sm ml-6 ${!answerGapsData ? 'text-gray-400' : 'text-gray-600'}`}>
                    {getReportDescription('answer-gaps')}
                    {!answerGapsData && ' (Requires website analysis data)'}
                  </p>
                </div>
              </div>
            </div>

            {/* Report Options */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Report Options</Label>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-charts"
                  checked={includeCharts}
                  onCheckedChange={(checked) => setIncludeCharts(checked as boolean)}
                />
                <Label htmlFor="include-charts" className="text-sm">
                  Include visual charts and graphs
                </Label>
              </div>
            </div>

            {/* Report Summary */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium mb-2">Report Summary</h4>
              <div className="text-sm text-gray-600 space-y-1">
                <p>• Company: {companyName}</p>
                <p>• Report Type: {selectedReportType === 'complete' ? 'Complete Dashboard' : 'Answer Gaps Analysis'}</p>
                <p>• Data Points: {responses.length} responses, {promptsData.length} prompts</p>
                {answerGapsData && selectedReportType === 'answer-gaps' && (
                  <p>• Actionable Tasks: {answerGapsData.actionableTasks.length}</p>
                )}
                <p>• Generated: {new Date().toLocaleDateString()}</p>
              </div>
            </div>

            {/* Generate Button */}
            <Button 
              onClick={handleGenerateReport}
              disabled={isGenerating || (selectedReportType === 'answer-gaps' && !answerGapsData)}
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Generate & Download PDF Report
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
