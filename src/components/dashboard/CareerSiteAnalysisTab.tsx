import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle, Clock, FileText, Download, Search, Loader2, TrendingUp, Globe, Target, Users, Building, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface CareerSiteAnalysisResult {
  // Content Analysis
  contentCoverage: {
    critical: { found: number; total: number; items: string[] };
    important: { found: number; total: number; items: string[] };
    niceToHave: { found: number; total: number; items: string[] };
  };
  contentStrengths: string[];
  contentScore: number;
  
  // Gap Analysis
  criticalGaps: string[];
  improvementAreas: string[];
  seoOpportunities: string[];
  
  // Competitive Analysis
  competitorAdvantages: string[];
  competitorMentions: Set<string>;
  competitiveScore: number;
  
  // AI Response Analysis
  responseAlignment: {
    highAlignment: number;
    mediumAlignment: number;
    lowAlignment: number;
    totalResponses: number;
    alignmentDetails: any[];
  };
  responseScore: number;
  
  // Strategic Recommendations
  recommendations: string[];
  
  // Overall Assessment
  overallScore: number;
  priorityActions: string[];
}

interface AnalysisResponse {
  success: boolean;
  analysis: CareerSiteAnalysisResult;
  scrapedContent: string;
  metadata: {
    title?: string;
    description?: string;
  };
  url: string;
  companyName: string;
  industry: string;
  error?: string;
}

interface ActionableTask {
  status: 'high' | 'medium' | 'low';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  fixType: string;
  evidence: string;
  suggestedAction: string;
}

export const CareerSiteAnalysisTab = () => {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CareerSiteAnalysisResult | null>(null);
  const [websiteMetadata, setWebsiteMetadata] = useState<any>(null);
  const [actionableTasks, setActionableTasks] = useState<ActionableTask[]>([]);
  const { toast } = useToast();
  const { user } = useAuth();

  // Convert analysis data to expected format
  const convertAnalysisToExpectedFormat = (analysis: any, crawlData: any): CareerSiteAnalysisResult => {
    return {
      // Content Analysis
      contentCoverage: {
        critical: { 
          found: analysis.missingElements.length === 0 ? 5 : Math.max(0, 5 - analysis.missingElements.length), 
          total: 5, 
          items: ['benefits', 'culture', 'growth', 'contact', 'company info'] 
        },
        important: { 
          found: Object.keys(analysis.careerKeywords).length, 
          total: 20, 
          items: Object.keys(analysis.careerKeywords) 
        },
        niceToHave: { 
          found: analysis.careerKeywords['diversity'] ? 1 : 0, 
          total: 1, 
          items: ['diversity'] 
        }
      },
      contentStrengths: analysis.keyFindings.filter((finding: string) => 
        finding.includes('present') || finding.includes('mentioned') || finding.includes('available')
      ),
      contentScore: analysis.overallScore,
      
      // Gap Analysis
      criticalGaps: analysis.missingElements.filter((element: string) => 
        ['Benefits information', 'Company culture information', 'Career growth opportunities'].includes(element)
      ),
      improvementAreas: analysis.missingElements.filter((element: string) => 
        !['Benefits information', 'Company culture information', 'Career growth opportunities'].includes(element)
      ),
      seoOpportunities: analysis.recommendations.filter((rec: string) => 
        rec.toLowerCase().includes('diversity') || rec.toLowerCase().includes('remote')
      ),
      
      // Competitive Analysis
      competitorAdvantages: [],
      competitorMentions: new Set(),
      competitiveScore: 100, // Not available in current analysis
      
      // AI Response Analysis
      responseAlignment: {
        highAlignment: 0,
        mediumAlignment: 0,
        lowAlignment: 0,
        totalResponses: 0,
        alignmentDetails: []
      },
      responseScore: 100, // Not available in current analysis
      
      // Strategic Recommendations
      recommendations: analysis.recommendations,
      
      // Overall Assessment
      overallScore: analysis.overallScore,
      priorityActions: analysis.missingElements.map((element: string) => 
        `Add ${element.toLowerCase()} to improve career site effectiveness`
      )
    };
  };

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast({
        title: "URL Required",
        description: "Please enter a career website URL to analyze.",
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
      // Step 1: Crawl the career site
      const { data: crawlData, error: crawlError } = await supabase.functions.invoke('crawl-career-site', {
        body: { url, userId: user.id }
      });

      if (crawlError) {
        throw crawlError;
      }

      if (!crawlData.success) {
        throw new Error(crawlData.error || 'Failed to crawl website');
      }

      // Step 2: Analyze the crawled content
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-crawled-content', {
        body: { 
          content: crawlData.data.content, 
          url, 
          userId: user.id 
        }
      });

      if (analysisError) {
        throw analysisError;
      }

      if (!analysisData.success) {
        throw new Error(analysisData.error || 'Analysis failed');
      }

      // Convert the analysis to the expected format
      const analysis = convertAnalysisToExpectedFormat(analysisData.analysis, crawlData.data);
      
      setAnalysisResult(analysis);
      setWebsiteMetadata(crawlData.data.metadata);
      
      // Convert analysis results to actionable tasks format
      const tasks: ActionableTask[] = [];
      
      // Add critical gaps as HIGH priority tasks
      analysis.criticalGaps.forEach(gap => {
        tasks.push({
          status: 'high',
          priority: 'HIGH',
          fixType: 'Create New Content',
          evidence: gap,
          suggestedAction: `Add comprehensive content addressing ${gap.toLowerCase()} to improve career site effectiveness.`
        });
      });

      // Add improvement areas as MEDIUM priority tasks
      analysis.improvementAreas.forEach(area => {
        tasks.push({
          status: 'medium',
          priority: 'MEDIUM',
          fixType: 'Enhance Content',
          evidence: area,
          suggestedAction: `Expand and improve existing content about ${area.toLowerCase()} to provide more comprehensive information.`
        });
      });

      // Add SEO opportunities as MEDIUM priority tasks
      analysis.seoOpportunities.forEach(opportunity => {
        tasks.push({
          status: 'medium',
          priority: 'MEDIUM',
          fixType: 'SEO Optimization',
          evidence: opportunity,
          suggestedAction: `Optimize content for search terms related to ${opportunity.toLowerCase()} to improve visibility.`
        });
      });

      // Add general recommendations as LOW priority tasks
      analysis.recommendations.forEach(rec => {
        if (!analysis.criticalGaps.some(gap => rec.includes(gap)) && 
            !analysis.improvementAreas.some(area => rec.includes(area))) {
          tasks.push({
            status: 'low',
            priority: 'LOW',
            fixType: 'General Improvement',
            evidence: rec,
            suggestedAction: rec
          });
        }
      });

      setActionableTasks(tasks);
      
      toast({
        title: "Analysis Complete",
        description: "Career site analysis completed successfully!",
        variant: "default",
      });
      
    } catch (error) {
      console.error('Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to analyze career site",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportAnalysis = () => {
    if (!analysisResult) return;
    
    const exportData = {
      url: url || 'Unknown URL',
      companyName: websiteMetadata?.companyName || 'Unknown',
      analysisDate: new Date().toISOString(),
      overallScore: analysisResult.overallScore,
      contentScore: analysisResult.contentScore,
      responseScore: analysisResult.responseScore,
      competitiveScore: analysisResult.competitiveScore,
      recommendations: analysisResult.recommendations,
      actionableTasks,
      contentCoverage: analysisResult.contentCoverage,
      responseAlignment: analysisResult.responseAlignment
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `career-site-analysis-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Career Site Analysis</h1>
          <p className="text-gray-600 mt-2">
            Analyze your career website content and identify gaps between what's published and what AI responses say about your company.
          </p>
        </div>
      </div>

      {/* URL Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Analyze Career Website
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Career Website URL</Label>
            <div className="flex gap-2">
              <Input
                id="url"
                type="url"
                placeholder="https://yourcompany.com/careers"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1"
              />
              <Button 
                onClick={handleAnalyze} 
                disabled={isAnalyzing || !url.trim()}
                className="min-w-[120px]"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Analyze
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-gray-500">
              Enter the URL of your company's career page or careers section
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Initial State - No Analysis Yet */}
      {!analysisResult && !isAnalyzing && (
        <Card>
          <CardContent className="text-center py-12">
            <Globe className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Analyze Career Site</h3>
            <p className="text-gray-600 mb-4">
              Enter your career website URL above and click "Analyze" to start identifying content gaps and alignment issues.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Analysis Results */}
      {analysisResult && (
        <div className="space-y-6">
          {/* Overall Score */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Overall Career Site Health Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-6xl font-bold text-blue-600 mb-2">
                  {analysisResult.overallScore}%
                </div>
                <p className="text-gray-600">
                  {analysisResult.overallScore >= 80 ? 'Excellent' : 
                   analysisResult.overallScore >= 60 ? 'Good' : 
                   analysisResult.overallScore >= 40 ? 'Fair' : 'Needs Improvement'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Content Coverage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Content Coverage Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-red-600 mb-1">
                    {analysisResult.contentCoverage.critical.found}/{analysisResult.contentCoverage.critical.total}
                  </div>
                  <div className="text-sm text-gray-600">Critical Topics</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Math.round((analysisResult.contentCoverage.critical.found / analysisResult.contentCoverage.critical.total) * 100)}% covered
                  </div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600 mb-1">
                    {analysisResult.contentCoverage.important.found}/{analysisResult.contentCoverage.important.total}
                  </div>
                  <div className="text-sm text-gray-600">Important Topics</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Math.round((analysisResult.contentCoverage.important.found / analysisResult.contentCoverage.important.total) * 100)}% covered
                  </div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-green-600 mb-1">
                    {analysisResult.contentCoverage.niceToHave.found}/{analysisResult.contentCoverage.niceToHave.total}
                  </div>
                  <div className="text-sm text-gray-600">Nice to Have</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Math.round((analysisResult.contentCoverage.niceToHave.found / analysisResult.contentCoverage.niceToHave.total) * 100)}% covered
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Response Alignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                AI Response Alignment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <div className="text-3xl font-bold text-purple-600 mb-2">
                  {analysisResult.responseScore}%
                </div>
                <p className="text-gray-600">Content supports AI responses</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-3 border rounded-lg bg-green-50">
                  <div className="text-xl font-bold text-green-600">
                    {analysisResult.responseAlignment.highAlignment}
                  </div>
                  <div className="text-sm text-gray-600">High Alignment</div>
                </div>
                <div className="text-center p-3 border rounded-lg bg-yellow-50">
                  <div className="text-xl font-bold text-yellow-600">
                    {analysisResult.responseAlignment.mediumAlignment}
                  </div>
                  <div className="text-sm text-gray-600">Medium Alignment</div>
                </div>
                <div className="text-center p-3 border rounded-lg bg-red-50">
                  <div className="text-xl font-bold text-red-600">
                    {analysisResult.responseAlignment.lowAlignment}
                  </div>
                  <div className="text-sm text-gray-600">Low Alignment</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Strategic Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Strategic Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysisResult.recommendations.map((recommendation, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <p className="text-gray-700">{recommendation}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actionable Tasks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Actionable Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {actionableTasks.map((task, index) => (
                  <div key={index} className="flex items-start gap-3 p-4 border rounded-lg">
                    <div className="flex-shrink-0">
                      {task.priority === 'HIGH' && <AlertTriangle className="h-5 w-5 text-red-600" />}
                      {task.priority === 'MEDIUM' && <Clock className="h-5 w-5 text-yellow-600" />}
                      {task.priority === 'LOW' && <CheckCircle className="h-5 w-5 text-green-600" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={task.priority === 'HIGH' ? 'destructive' : task.priority === 'MEDIUM' ? 'secondary' : 'default'}>
                          {task.priority}
                        </Badge>
                        <Badge variant="outline">{task.fixType}</Badge>
                      </div>
                      <p className="text-gray-700 mb-2">{task.suggestedAction}</p>
                      <p className="text-sm text-gray-500">
                        <strong>Evidence:</strong> {task.evidence}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Export Button */}
          <div className="flex justify-center">
            <Button onClick={exportAnalysis} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export Analysis Report
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
