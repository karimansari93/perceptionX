import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { OrganizationManagementTab } from '@/components/admin/OrganizationManagementTab';
import { UsersTab } from '@/components/admin/UsersTab';
import { VisibilityRankingsTab } from '@/components/admin/VisibilityRankingsTab';
import { CompanyBatchTab } from '@/components/admin/CompanyBatchTab';
import { RecencyCoverageTab } from '@/components/admin/RecencyCoverageTab';
import { DataHealthTab } from '@/components/admin/DataHealthTab';
import { EntityCanonicalizationTab } from '@/components/admin/EntityCanonicalizationTab';
import { OnboardingFormsTab } from '@/components/admin/OnboardingFormsTab';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function Admin() {
  // Tab lives in the URL (?tab=…) so sub-pages like the brief review can link
  // back to the tab they came from, and refresh keeps the admin where they were.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'organizations';
  const setActiveTab = (tab: string) => setSearchParams({ tab }, { replace: true });
  useDocumentTitle('Admin');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'organizations':
        return <OrganizationManagementTab />;
      case 'data-health':
        return <DataHealthTab />;
      case 'users':
        return <UsersTab />;
      case 'visibility-rankings':
        return <VisibilityRankingsTab />;
      case 'company-batch':
        return <CompanyBatchTab />;
      case 'recency-coverage':
        return <RecencyCoverageTab />;
      case 'entity-canonicalization':
        return <EntityCanonicalizationTab />;
      case 'onboarding-forms':
        return <OnboardingFormsTab />;
      default:
        return <OrganizationManagementTab />;
    }
  };

  return (
    <AdminLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderTabContent()}
    </AdminLayout>
  );
}











