import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  FileText, 
  BarChart3, 
  TrendingUp, 
  Users, 
  Target, 
  Award,
  Brain,
  Lightbulb,
  AlertCircle,
  CheckCircle,
  Loader2,
  Building2,
  Calendar,
  Mail,
  Globe,
  MapPin
} from 'lucide-react';
import { CompanyReportService } from '@/services/companyReportService';
import { 
  CompanyReportData, 
  ComparisonData, 
  ThemeData, 
  CompetitorMention, 
  AIModelPerformance 
} from '@/types/companyReport';
import { toast } from 'sonner';

interface Company {
  id: string;
  name: string;
  industry: string;
  email: string;
}

interface CompanyReportTabProps {
  onClose?: () => void;
}

export const CompanyReportTab: React.FC<CompanyReportTabProps> = ({ onClose }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [reportData, setReportData] = useState<CompanyReportData | ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState<'single' | 'comparison'>('single');
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const companiesData = await CompanyReportService.getAvailableCompanies();
      setCompanies(companiesData);
    } catch (error) {
      console.error('Error fetching companies:', error);
      toast.error('Failed to fetch companies');
    }
  };

  const handleGenerateReport = async () => {
    if (selectedCompanies.length === 0) {
      toast.error('Please select at least one company');
      return;
    }

    if (reportType === 'comparison' && selectedCompanies.length < 2) {
      toast.error('Please select at least 2 companies for comparison');
      return;
    }

    setLoading(true);
    try {
      let response;
      if (reportType === 'single') {
        response = await CompanyReportService.generateCompanyReport(selectedCompanies[0]);
      } else {
        response = await CompanyReportService.generateComparisonReport(selectedCompanies);
      }

      if (response.success && response.data) {
        setReportData(response.data);
        setShowReport(true);
        toast.success('Report generated successfully');
      } else {
        toast.error(response.error || 'Failed to generate report');
      }
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const getSentimentColor = (sentiment: number) => {
    if (sentiment > 0.1) return 'text-green-600';
    if (sentiment < -0.1) return 'text-red-600';
    return 'text-yellow-600';
  };

  const getSentimentLabel = (sentiment: number) => {
    if (sentiment > 0.1) return 'Positive';
    if (sentiment < -0.1) return 'Negative';
    return 'Neutral';
  };

  const renderSingleReport = (data: CompanyReportData) => (
    <div className="space-y-6">
      {/* Company Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Company Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{data.totalResponses}</div>
              <div className="text-sm text-gray-600">Total Responses</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${getSentimentColor(data.averageSentiment)}`}>
                {data.averageSentiment.toFixed(2)}
              </div>
              <div className="text-sm text-gray-600">Avg Sentiment</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {(data.visibilityScore * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600">Visibility Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {data.competitivePosition.toFixed(1)}
              </div>
              <div className="text-sm text-gray-600">Competitive Position</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Key Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.keyInsights.map((insight, index) => (
              <div key={index} className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                <Lightbulb className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{insight}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.recommendations.map((recommendation, index) => (
              <div key={index} className="flex items-start gap-2 p-3 bg-green-50 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{recommendation}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Themes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Top Themes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Theme</TableHead>
                <TableHead>Attribute</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topThemes.map((theme, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{theme.theme_name}</div>
                      <div className="text-sm text-gray-600">{theme.theme_description}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{theme.talentx_attribute_name}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className={`font-medium ${getSentimentColor(theme.sentiment_score)}`}>
                      {getSentimentLabel(theme.sentiment_score)}
                    </div>
                    <div className="text-sm text-gray-600">{theme.sentiment_score.toFixed(2)}</div>
                  </TableCell>
                  <TableCell>{theme.frequency}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={theme.confidence_score * 100} className="w-16" />
                      <span className="text-sm">{(theme.confidence_score * 100).toFixed(0)}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Competitor Mentions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Competitor Mentions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competitor</TableHead>
                <TableHead>Mentions</TableHead>
                <TableHead>Sentiment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.competitorMentions.map((competitor, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{competitor.competitor}</TableCell>
                  <TableCell>{competitor.frequency}</TableCell>
                  <TableCell>
                    <div className={`font-medium ${getSentimentColor(competitor.sentiment)}`}>
                      {getSentimentLabel(competitor.sentiment)}
                    </div>
                    <div className="text-sm text-gray-600">{competitor.sentiment.toFixed(2)}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* AI Model Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5" />
            AI Model Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Responses</TableHead>
                <TableHead>Avg Sentiment</TableHead>
                <TableHead>Mention Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.aiModelPerformance.map((model, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{model.model}</TableCell>
                  <TableCell>{model.responses}</TableCell>
                  <TableCell>
                    <div className={`font-medium ${getSentimentColor(model.averageSentiment)}`}>
                      {getSentimentLabel(model.averageSentiment)}
                    </div>
                    <div className="text-sm text-gray-600">{model.averageSentiment.toFixed(2)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={model.mentionRate * 100} className="w-16" />
                      <span className="text-sm">{(model.mentionRate * 100).toFixed(1)}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Geographic Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Geographic Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Geographic Insights */}
            <div className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Geographic Insights
              </h4>
              <div className="space-y-2">
                {data.geographicAnalysis.geographicInsights.map((insight, index) => (
                  <div key={index} className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                    <Globe className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{insight}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Countries */}
            <div className="space-y-3">
              <h4 className="font-semibold">Top Countries by Source Count</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.geographicAnalysis.topCountries.map((country, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{country.flag}</span>
                      <span className="font-medium">{country.country}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-blue-600">{country.sources}</div>
                      <div className="text-sm text-gray-600">{country.percentage.toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Regional Distribution */}
            <div className="space-y-3">
              <h4 className="font-semibold">Regional Distribution</h4>
              <div className="space-y-2">
                {data.geographicAnalysis.regions.map((region, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium">{region.region}</span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Progress value={region.percentage} className="w-24" />
                        <span className="text-sm font-medium">{region.percentage.toFixed(1)}%</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        {region.sources} sources
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Country Breakdown */}
            <div className="space-y-3">
              <h4 className="font-semibold">Detailed Country Breakdown</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead>Percentage</TableHead>
                    <TableHead>Platforms</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.geographicAnalysis.countries.slice(0, 10).map((country, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{country.flag}</span>
                          <span className="font-medium">{country.country}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{country.region}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{country.sources}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={country.percentage} className="w-16" />
                          <span className="text-sm">{country.percentage.toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {country.domains.slice(0, 3).map((domain, domainIndex) => (
                            <Badge key={domainIndex} variant="secondary" className="text-xs">
                              {domain}
                            </Badge>
                          ))}
                          {country.domains.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{country.domains.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderComparisonReport = (data: ComparisonData) => (
    <div className="space-y-6">
      {/* Comparison Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Comparison Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-2">Best Performing</h4>
              <div className="text-lg font-bold text-green-600">{data.competitiveAnalysis.bestPerforming}</div>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Most Visible</h4>
              <div className="text-lg font-bold text-blue-600">{data.competitiveAnalysis.mostVisible}</div>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Strongest Themes</h4>
              <div className="text-sm text-gray-600">{data.competitiveAnalysis.strongestThemes}</div>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Areas for Improvement</h4>
              <div className="space-y-1">
                {data.competitiveAnalysis.areasForImprovement.map((area, index) => (
                  <div key={index} className="text-sm text-red-600">{area}</div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Comparison Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.comparisonInsights.map((insight, index) => (
              <div key={index} className="flex items-start gap-2 p-3 bg-purple-50 rounded-lg">
                <Lightbulb className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{insight}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Individual Company Reports */}
      {data.companies.map((company, index) => (
        <Card key={index}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              {company.companyName} ({company.industry})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-blue-600">{company.totalResponses}</div>
                <div className="text-sm text-gray-600">Responses</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold ${getSentimentColor(company.averageSentiment)}`}>
                  {company.averageSentiment.toFixed(2)}
                </div>
                <div className="text-sm text-gray-600">Sentiment</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-purple-600">
                  {(company.visibilityScore * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-gray-600">Visibility</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-orange-600">
                  {company.competitivePosition.toFixed(1)}
                </div>
                <div className="text-sm text-gray-600">Position</div>
              </div>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold">Top Themes:</h4>
              <div className="flex flex-wrap gap-2">
                {company.topThemes.slice(0, 5).map((theme, themeIndex) => (
                  <Badge key={themeIndex} variant="outline">
                    {theme.talentx_attribute_name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Report Generation Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Generate Company Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Report Type Selection */}
            <div className="flex gap-4">
              <Button
                variant={reportType === 'single' ? 'default' : 'outline'}
                onClick={() => setReportType('single')}
              >
                Single Company
              </Button>
              <Button
                variant={reportType === 'comparison' ? 'default' : 'outline'}
                onClick={() => setReportType('comparison')}
              >
                Compare Companies
              </Button>
            </div>

            {/* Company Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Select {reportType === 'single' ? 'Company' : 'Companies'}:
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                {companies.map((company) => (
                  <div
                    key={company.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      selectedCompanies.includes(company.id)
                        ? 'bg-blue-100 border-blue-300'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      if (reportType === 'single') {
                        setSelectedCompanies([company.id]);
                      } else {
                        setSelectedCompanies(prev => 
                          prev.includes(company.id)
                            ? prev.filter(id => id !== company.id)
                            : [...prev, company.id]
                        );
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCompanies.includes(company.id)}
                      onChange={() => {}}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{company.name}</div>
                      <div className="text-sm text-gray-600">{company.industry}</div>
                      <div className="text-xs text-gray-500">{company.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerateReport}
              disabled={loading || selectedCompanies.length === 0}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Report
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Display Modal */}
      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {reportType === 'single' ? 'Company Report' : 'Company Comparison Report'}
            </DialogTitle>
          </DialogHeader>
          
          {reportData && (
            <div className="space-y-6">
              {reportType === 'single' 
                ? renderSingleReport(reportData as CompanyReportData)
                : renderComparisonReport(reportData as ComparisonData)
              }
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
