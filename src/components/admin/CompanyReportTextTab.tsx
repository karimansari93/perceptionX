import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  FileText, 
  Copy, 
  Download,
  Loader2,
  Building2,
  Users,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { CompanyReportTextService } from '@/services/companyReportTextService';
import { toast } from 'sonner';

interface Company {
  id: string;
  name: string;
  industry: string;
  email: string;
}

interface CompanyReportTextTabProps {
  onClose?: () => void;
}

export const CompanyReportTextTab: React.FC<CompanyReportTextTabProps> = ({ onClose }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [reportText, setReportText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState<'single' | 'comparison'>('single');

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const companiesData = await CompanyReportTextService.getAvailableCompanies();
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
    setReportText('');
    
    try {
      let response;
      if (reportType === 'single') {
        response = await CompanyReportTextService.generateCompanyReport(selectedCompanies[0]);
      } else {
        response = await CompanyReportTextService.generateComparisonReport(selectedCompanies);
      }

      if (response.success && response.report) {
        setReportText(response.report);
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

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      toast.success('Report copied to clipboard');
    } catch (error) {
      console.error('Error copying report:', error);
      toast.error('Failed to copy report');
    }
  };

  const handleDownloadReport = () => {
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `company-report-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Report downloaded');
  };

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
                {companies.map((company, index) => (
                  <div
                    key={`${company.id}-${index}`}
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

      {/* Report Display */}
      {reportText && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Generated Report
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCopyReport}
                  variant="outline"
                  size="sm"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
                <Button
                  onClick={handleDownloadReport}
                  variant="outline"
                  size="sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-green-800">
                  <strong>Report Ready!</strong> You can now copy this text and send it to leadership. 
                  The report includes executive summary, key metrics, themes, competitive analysis, 
                  geographic distribution, and actionable recommendations.
                </div>
              </div>
              
              <Textarea
                value={reportText}
                readOnly
                className="min-h-[600px] font-mono text-sm"
                placeholder="Generated report will appear here..."
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            How to Use
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <strong>Single Company Report:</strong> Select one company to generate a comprehensive talent perception report
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <strong>Comparison Report:</strong> Select multiple companies to compare their talent perception side-by-side
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <strong>Copy & Share:</strong> Use the Copy button to copy the report text, then paste it into emails, documents, or presentations
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <strong>Download:</strong> Use the Download button to save the report as a text file for offline use
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
