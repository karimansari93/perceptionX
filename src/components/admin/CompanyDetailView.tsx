import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, Edit, Hash, Search, Clock, Database } from 'lucide-react';
import { CompanyEditTab } from './company-detail/CompanyEditTab';
import { CompanySearchTermsTab } from './company-detail/CompanySearchTermsTab';
import { CompanySearchInsightsTab } from './company-detail/CompanySearchInsightsTab';
import { CompanyRecencyTestTab } from './company-detail/CompanyRecencyTestTab';
import { CompanyCollectionTab } from './company-detail/CompanyCollectionTab';

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
  const [activeTab, setActiveTab] = useState('collection');

  return (
    <div className="space-y-4">
      {/* Header - compact */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <Button
            onClick={onBack}
            variant="ghost"
            size="sm"
            className="mb-3 text-slate-600 hover:text-slate-800 -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Companies
          </Button>
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-md bg-slate-100 text-slate-500 flex-shrink-0">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-headline font-semibold text-slate-800 truncate">{company.name}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="outline" className="border-slate-200 text-slate-600 bg-slate-50 text-xs font-normal">
                  {company.industry}
                </Badge>
                <span className="text-xs text-slate-500">
                  {company.organization_name}
                </span>
              </div>
              {company.last_updated && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Last updated: {new Date(company.last_updated).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs - subtle active state */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white border border-slate-200 shadow-sm p-0.5 h-9">
          <TabsTrigger
            value="collection"
            className="data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800 data-[state=active]:shadow-none text-slate-600 text-sm h-8 px-3"
          >
            <Database className="h-3.5 w-3.5 mr-1.5" />
            Collection
          </TabsTrigger>
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800 data-[state=active]:shadow-none text-slate-600 text-sm h-8 px-3"
          >
            <Edit className="h-3.5 w-3.5 mr-1.5" />
            Overview & Edit
          </TabsTrigger>
          <TabsTrigger
            value="search-terms"
            className="data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800 data-[state=active]:shadow-none text-slate-600 text-sm h-8 px-3"
          >
            <Hash className="h-3.5 w-3.5 mr-1.5" />
            Search Terms
          </TabsTrigger>
          <TabsTrigger
            value="search-insights"
            className="data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800 data-[state=active]:shadow-none text-slate-600 text-sm h-8 px-3"
          >
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Search Insights
          </TabsTrigger>
          <TabsTrigger
            value="recency-test"
            className="data-[state=active]:bg-slate-100 data-[state=active]:text-slate-800 data-[state=active]:shadow-none text-slate-600 text-sm h-8 px-3"
          >
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Recency Test
          </TabsTrigger>
        </TabsList>

        <TabsContent value="collection" className="mt-4">
          <CompanyCollectionTab
            companyId={company.id}
            companyName={company.name}
            organizationId={company.organization_id}
            onUpdate={onUpdate}
          />
        </TabsContent>

        <TabsContent value="overview" className="mt-4">
          <CompanyEditTab company={company} onUpdate={onUpdate} onRefresh={onRefresh} onDelete={onDelete} />
        </TabsContent>

        <TabsContent value="search-terms" className="mt-4">
          <CompanySearchTermsTab companyId={company.id} companyName={company.name} />
        </TabsContent>

        <TabsContent value="search-insights" className="mt-4">
          <CompanySearchInsightsTab companyId={company.id} companyName={company.name} />
        </TabsContent>

        <TabsContent value="recency-test" className="mt-4">
          <CompanyRecencyTestTab companyId={company.id} companyName={company.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
};


