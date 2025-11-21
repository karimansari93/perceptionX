import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, Edit, Hash, FileText, Search, Clock } from 'lucide-react';
import { CompanyEditTab } from './company-detail/CompanyEditTab';
import { CompanySearchTermsTab } from './company-detail/CompanySearchTermsTab';
import { CompanyReportsTab } from './company-detail/CompanyReportsTab';
import { CompanySearchInsightsTab } from './company-detail/CompanySearchInsightsTab';
import { CompanyRecencyTestTab } from './company-detail/CompanyRecencyTestTab';

interface Company {
  id: string;
  name: string;
  industry: string;
  created_at: string;
  organization_id: string;
  organization_name: string;
  last_updated: string | null;
}

interface CompanyDetailViewProps {
  company: Company;
  onBack: () => void;
  onUpdate: () => void;
  onRefresh?: (companyId: string) => void;
  onDelete?: () => void;
}

export const CompanyDetailView = ({ company, onBack, onUpdate, onRefresh, onDelete }: CompanyDetailViewProps) => {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Button 
            onClick={onBack} 
            variant="ghost" 
            className="mb-4 text-nightsky/70 hover:text-nightsky -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Companies
          </Button>
          <div className="flex items-start gap-4">
            <div className="bg-pink/10 p-3 rounded-lg">
              <Building2 className="h-8 w-8 text-pink" />
            </div>
            <div>
              <h1 className="text-3xl font-headline font-bold text-nightsky">{company.name}</h1>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant="outline" className="border-teal/30 text-teal bg-teal/5">
                  {company.industry}
                </Badge>
                <span className="text-sm text-nightsky/60">
                  Organization: {company.organization_name}
                </span>
              </div>
              {company.last_updated && (
                <p className="text-sm text-nightsky/50 mt-1">
                  Last updated: {new Date(company.last_updated).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white border border-silver shadow-sm">
          <TabsTrigger 
            value="overview" 
            className="data-[state=active]:bg-pink data-[state=active]:text-white"
          >
            <Edit className="h-4 w-4 mr-2" />
            Overview & Edit
          </TabsTrigger>
          <TabsTrigger 
            value="search-terms"
            className="data-[state=active]:bg-pink data-[state=active]:text-white"
          >
            <Hash className="h-4 w-4 mr-2" />
            Search Terms
          </TabsTrigger>
          <TabsTrigger 
            value="reports"
            className="data-[state=active]:bg-pink data-[state=active]:text-white"
          >
            <FileText className="h-4 w-4 mr-2" />
            Reports
          </TabsTrigger>
          <TabsTrigger 
            value="search-insights"
            className="data-[state=active]:bg-pink data-[state=active]:text-white"
          >
            <Search className="h-4 w-4 mr-2" />
            Search Insights
          </TabsTrigger>
          <TabsTrigger 
            value="recency-test"
            className="data-[state=active]:bg-pink data-[state=active]:text-white"
          >
            <Clock className="h-4 w-4 mr-2" />
            Recency Test
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <CompanyEditTab company={company} onUpdate={onUpdate} onRefresh={onRefresh} onDelete={onDelete} />
        </TabsContent>

        <TabsContent value="search-terms" className="mt-6">
          <CompanySearchTermsTab companyId={company.id} companyName={company.name} />
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <CompanyReportsTab company={company} />
        </TabsContent>

        <TabsContent value="search-insights" className="mt-6">
          <CompanySearchInsightsTab companyId={company.id} companyName={company.name} />
        </TabsContent>

        <TabsContent value="recency-test" className="mt-6">
          <CompanyRecencyTestTab companyId={company.id} companyName={company.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
};


