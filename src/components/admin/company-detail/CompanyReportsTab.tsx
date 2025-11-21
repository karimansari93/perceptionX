import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Download } from 'lucide-react';
import { CompanyReportTab } from '../CompanyReportTab';

interface Company {
  id: string;
  name: string;
  industry: string;
}

interface CompanyReportsTabProps {
  company: Company;
}

export const CompanyReportsTab = ({ company }: CompanyReportsTabProps) => {
  return (
    <div className="space-y-6">
      <Card className="border-none shadow-md">
        <CardHeader>
          <CardTitle className="text-nightsky flex items-center gap-2">
            <FileText className="h-5 w-5 text-pink" />
            Company Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-nightsky/60 mb-4">
            Generate detailed reports and analytics for {company.name}
          </p>
          {/* Use existing CompanyReportTab component */}
          <CompanyReportTab />
        </CardContent>
      </Card>
    </div>
  );
};











