import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FileText, Download, Loader2 } from 'lucide-react';
import { useCompany } from '@/contexts/CompanyContext';
import { downloadPdfReport } from '@/services/pdfReportService';
import { toast } from 'sonner';

interface ReportGeneratorProps {
  companyName: string;
  metrics: any;
  responses: any[];
  sentimentTrend: any[];
  topCitations: any[];
  promptsData: any[];
  answerGapsData?: any;
}

export const ReportGenerator = ({
  companyName,
}: ReportGeneratorProps) => {
  const { currentCompany } = useCompany();
  const [isGenerating, setIsGenerating] = useState(false);
  const [period1, setPeriod1] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [period2, setPeriod2] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [market, setMarket] = useState('Global');

  const handleDownload = async () => {
    if (!currentCompany?.id) {
      toast.error('No company selected');
      return;
    }

    setIsGenerating(true);
    try {
      await downloadPdfReport({
        company_id: currentCompany.id,
        period1,
        period2,
        market,
      });
      toast.success('Report downloaded successfully');
    } catch (err: any) {
      console.error('Report download failed:', err);
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Generate Perception Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium mb-1">Company</h4>
          <p className="text-sm text-gray-600">{companyName}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="period1">Period 1 (YYYY-MM)</Label>
            <Input
              id="period1"
              type="month"
              value={period1}
              onChange={(e) => setPeriod1(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period2">Period 2 (YYYY-MM)</Label>
            <Input
              id="period2"
              type="month"
              value={period2}
              onChange={(e) => setPeriod2(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="market">Market</Label>
          <Input
            id="market"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="e.g. Global, North America, EMEA"
          />
        </div>

        <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-600 space-y-1">
          <p>The report compares perception metrics between two monthly periods:</p>
          <p>Visibility, Discovery rate, Competitive landscape, Source footprint, and Perception themes.</p>
        </div>

        <Button
          onClick={handleDownload}
          disabled={isGenerating || !currentCompany?.id}
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
              Download PDF Report
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
