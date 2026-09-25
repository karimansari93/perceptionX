import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Eye, FileText, Mail, UserPlus } from 'lucide-react';
import { OrganizationDataDetail } from './OrganizationDataDetail';
import { CompanyBatchTab } from './CompanyBatchTab';
import { ActivateTab } from './ActivateTab';

// Everything an admin does for ONE client lives here, so the sidebar only
// carries platform-wide tools. The section is kept in the URL (?section=)
// next to ?org= so refresh and shared links land in the same place.
const SECTIONS = [
  { id: 'data', label: 'Companies & data' },
  { id: 'collection', label: 'Collection' },
  { id: 'activate', label: 'Activate' },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

type Props = {
  org: { id: string; name: string; description?: string | null };
  onBack: () => void;
  onOpenReports: () => void;
  onViewMembers: () => void;
  onAddUser: () => void;
  onInvite: () => void;
};

export const OrgWorkspace = ({ org, onBack, onOpenReports, onViewMembers, onAddUser, onInvite }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('section');
  const section: Section = SECTIONS.some((s) => s.id === raw) ? (raw as Section) : 'data';

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
          <div>
            <h1 className="text-2xl font-headline font-bold text-slate-900">{org.name}</h1>
            {org.description && <p className="text-sm text-slate-500 mt-0.5">{org.description}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={onOpenReports} size="sm" variant="outline" className="border-slate-200 text-slate-600 h-8 text-xs">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Reports
            </Button>
            <Button onClick={onViewMembers} size="sm" variant="outline" className="border-slate-200 text-slate-600 h-8 text-xs">
              <Eye className="h-3.5 w-3.5 mr-1" />
              Members
            </Button>
            <Button onClick={onAddUser} size="sm" variant="outline" className="border-slate-200 text-slate-600 h-8 text-xs">
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Add user
            </Button>
            <Button
              onClick={onInvite}
              size="sm"
              variant="outline"
              className="border-slate-200 text-slate-600 h-8 text-xs"
              title="Email invites attributed to one of this organization's Super Admins"
            >
              <Mail className="h-3.5 w-3.5 mr-1" />
              Invite as admin
            </Button>
          </div>
        </div>

        <Tabs value={section} onValueChange={setSection}>
          <TabsList>
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {section === 'data' && <OrganizationDataDetail org={org} onBack={onBack} hideHeader />}
      {section === 'collection' && <CompanyBatchTab lockedOrganizationId={org.id} />}
      {section === 'activate' && <ActivateTab organizationId={org.id} />}
    </div>
  );
};
