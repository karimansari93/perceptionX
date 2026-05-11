import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { OrganizationManagementTab } from '@/components/admin/OrganizationManagementTab';
import { UsersTab } from '@/components/admin/UsersTab';
import { CompanyManagementTab } from '@/components/admin/CompanyManagementTab';
import { VisibilityRankingsTab } from '@/components/admin/VisibilityRankingsTab';
import { CompanyBatchTab } from '@/components/admin/CompanyBatchTab';
import { RecencyCoverageTab } from '@/components/admin/RecencyCoverageTab';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function Admin() {
  const [activeTab, setActiveTab] = useState<string>('organizations');
  useDocumentTitle('Admin');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'organizations':
        return <OrganizationManagementTab />;
      case 'users':
        return <UsersTab />;
      case 'companies':
        return <CompanyManagementTab />;
      case 'visibility-rankings':
        return <VisibilityRankingsTab />;
      case 'company-batch':
        return <CompanyBatchTab />;
      case 'recency-coverage':
        return <RecencyCoverageTab />;
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











