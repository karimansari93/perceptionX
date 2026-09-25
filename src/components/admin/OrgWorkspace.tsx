import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { OrgCompaniesPanel } from './OrgCompaniesPanel';
import { CompanyBatchTab } from './CompanyBatchTab';
import { ActivateTab } from './ActivateTab';
import { RecencyCoverageTab } from './RecencyCoverageTab';
import { OrgLogo } from './OrgLogo';
import { WorkspaceActionsSlot } from './WorkspaceActions';

// Everything an admin does for ONE client lives here, so the sidebar only
// carries platform-wide tools. The section is kept in the URL (?section=)
// next to ?org= so refresh and shared links land in the same place.
const SECTIONS = [
  { id: 'companies', label: 'Companies' },
  { id: 'collection', label: 'Collection' },
  { id: 'recency', label: 'Recency' },
  { id: 'members', label: 'Members' },
  { id: 'reports', label: 'Reports' },
  { id: 'activate', label: 'Activate' },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

type Props = {
  org: { id: string; name: string; description?: string | null };
  logoSrc?: string;
  onBack: () => void;
  /** Rendered by OrganizationManagementTab, which owns their state and dialogs. */
  reportsPanel: ReactNode;
  membersPanel: ReactNode;
};

export const OrgWorkspace = ({ org, logoSrc, onBack, reportsPanel, membersPanel }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Right end of the tab bar; sections portal their buttons into it.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const raw = searchParams.get('section');
  const section: Section = SECTIONS.some((s) => s.id === raw) ? (raw as Section) : 'companies';

  const setSection = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Button onClick={onBack} variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          All organizations
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <OrgLogo name={org.name} src={logoSrc} size="lg" />
            <div>
              <h1 className="text-2xl font-headline font-bold text-slate-900">{org.name}</h1>
              {org.description && <p className="text-sm text-slate-500 mt-0.5">{org.description}</p>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={section} onValueChange={setSection}>
            <TabsList>
              {SECTIONS.map((s) => (
                <TabsTrigger key={s.id} value={s.id}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div ref={setActionsSlot} className="flex flex-wrap items-center gap-2 empty:hidden" />
        </div>
      </div>

      <WorkspaceActionsSlot.Provider value={actionsSlot}>

      {section === 'companies' && <OrgCompaniesPanel organizationId={org.id} />}
      {section === 'collection' && <CompanyBatchTab lockedOrganizationId={org.id} />}
      {section === 'recency' && <RecencyCoverageTab organizationId={org.id} />}
      {section === 'members' && membersPanel}
      {section === 'reports' && reportsPanel}
      {section === 'activate' && <ActivateTab organizationId={org.id} />}
      </WorkspaceActionsSlot.Provider>
    </div>
  );
};
