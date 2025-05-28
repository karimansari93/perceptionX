import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle, Clock, FileText, Download, Search, Loader2, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface GapAnalysisResult {
  criticalGaps: string[];
  improvementAreas: string[];
  competitorAdvantages: string[];
  recommendations: string[];
  contentScore: number;
}

interface AnalysisResponse {
  success: boolean;
  analysis: GapAnalysisResult;
  scrapedContent: string;
  metadata: {
    title?: string;
    description?: string;
  };
  error?: string;
}

interface ActionableTask {
  status: 'high' | 'medium' | 'low';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  fixType: string;
  evidence: string;
  suggestedAction: string;
}

export const AnswerGapsTab = () => {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<GapAnalysisResult | null>(null);
  const [websiteMetadata, setWebsiteMetadata] = useState<any>(null);
  const [actionableTasks, setActionableTasks] = useState<ActionableTask[]>([]);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast({
        title: "URL Required",
        description: "Please enter a website URL to analyze.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to use this feature.",
        variant: "destructive",
      });
      return;
    }

    try {
      new URL(url);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid website URL (including https://).",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);
    setWebsiteMetadata(null);
    setActionableTasks([]);
    
    try {
      const { data, error } = await supabase.functions.invoke('analyze-website-gaps', {
        body: { url, userId: user.id }
      });

      if (error) {
        throw error;
      }

      const response: AnalysisResponse = data;

      if (!response.success) {
        throw new Error(response.error || 'Analysis failed');
      }

      setAnalysisResult(response.analysis);
      setWebsiteMetadata(response.metadata);
      
      // Convert analysis results to actionable tasks format
      const tasks: ActionableTask[] = [];
      
      // Add critical gaps as HIGH priority tasks
      response.analysis.criticalGaps.forEach(gap => {
        tasks.push({
          status: 'high',
          priority: 'HIGH',
          fixType: 'Create New Content',
          evidence: gap,
          suggestedAction: `Add comprehensive content addressing ${gap.toLowerCase()} to improve AI response coverage and competitiveness.`
        });
      });

      // Add improvement areas as MEDIUM priority tasks
      response.analysis.improvementAreas.forEach(area => {
        tasks.push({
          status: 'medium',
          priority: 'MEDIUM',
          fixType: 'Update Existing Content',
          evidence: area,
          suggestedAction: `Enhance existing content with more detailed information about ${area.toLowerCase()} to strengthen AI visibility.`
        });
      });

      // Add competitor advantages as HIGH priority strategic tasks
      response.analysis.competitorAdvantages.forEach(advantage => {
        tasks.push({
          status: 'high',
          priority: 'HIGH',
          fixType: 'Publish Comparison',
          evidence: advantage,
          suggestedAction: 'Create differentiation content highlighting unique value propositions and competitive advantages to counter competitor mentions in AI responses.'
        });
      });

      setActionableTasks(tasks);
      
      // Store answer gaps data for reports
      const answerGapsData = {
        contentScore: response.analysis.contentScore,
        actionableTasks: tasks,
        websiteMetadata: response.metadata
      };
      
      // Store in sessionStorage for the reports tab to access
      sessionStorage.setItem('answerGapsData', JSON.stringify(answerGapsData));
      
      toast({
        title: "Analysis Complete",
        description: `Found ${tasks.length} actionable tasks to improve your AI visibility.`,
      });
    } catch (error) {
      console.error('Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to analyze website",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 bg-green-50 border-green-200";
    if (score >= 60) return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  const getPriorityBadge = (priority: string) => {
    const colorMap = {
      'HIGH': 'bg-red-500 text-white',
      'MEDIUM': 'bg-yellow-500 text-white',
      'LOW': 'bg-gray-500 text-white'
    };
    
    return (
      <Badge className={`${colorMap[priority as keyof typeof colorMap]} text-xs font-medium px-2 py-1`}>
        {priority}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* URL Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Website Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="website-url">Career Website URL</Label>
            <Input
              id="website-url"
              type="url"
              placeholder="https://www.company.com/careers"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isAnalyzing}
            />
          </div>
          
          <Button 
            onClick={handleAnalyze} 
            disabled={isAnalyzing || !url.trim()}
            className="w-full sm:w-auto"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Website...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Analyze Website
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results Section */}
      {analysisResult && (
        <>
          {/* Content Score Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Content Analysis Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-center p-6 rounded-lg border ${getScoreColor(analysisResult.contentScore)}`}>
                <div className="text-3xl font-bold mb-2">{analysisResult.contentScore}%</div>
                <p className="text-sm">
                  {websiteMetadata?.title && `Analysis of ${websiteMetadata.title}`}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Actionable Tasks Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Actionable Tasks ({actionableTasks.length} remaining)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Priority</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Fix Type</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Evidence / Insight</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-600 text-sm">Suggested Action / Playbook</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionableTasks.map((task, index) => (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 px-4">
                          <div className="flex items-center">
                            <input type="checkbox" className="w-4 h-4 rounded border-gray-300" />
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {getPriorityBadge(task.priority)}
                        </td>
                        <td className="py-4 px-4">
                          <span className="font-medium text-gray-900 text-sm">{task.fixType}</span>
                        </td>
                        <td className="py-4 px-4 max-w-md">
                          <span className="text-sm text-gray-700">{task.evidence}</span>
                        </td>
                        <td className="py-4 px-4 max-w-lg">
                          <span className="text-sm text-gray-700">{task.suggestedAction}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!analysisResult && !isAnalyzing && (
        <Card>
          <CardContent className="text-center py-12">
            <Search className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Analyze</h3>
            <p className="text-gray-600">
              Enter your career website URL above to start the gap analysis
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
