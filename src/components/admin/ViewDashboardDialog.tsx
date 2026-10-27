import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, User, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany, type ViewAsMember } from '@/contexts/CompanyContext';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface OrgOption {
  id: string;
  name: string;
}

interface ViewDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Platform admins can open the client dashboard as any organization. Picking
// one lands them on that organization's company (US profile when it has one),
// so they can demo the product without hunting through the company dropdown.
// The second step lists the organization's members: opening as one of them
// applies their default company, saved location and role, read only.
export const ViewDashboardDialog = ({ open, onOpenChange }: ViewDashboardDialogProps) => {
  const navigate = useNavigate();
  const { viewAsOrganization } = useCompany();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pickedOrg, setPickedOrg] = useState<OrgOption | null>(null);
  const [members, setMembers] = useState<ViewAsMember[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuery('');
    setPickedOrg(null);
    setMembers(null);
    supabase
      .from('organizations')
      .select('id, name')
      .order('name')
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError('Could not load organizations');
        setOrgs((data as OrgOption[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? orgs.filter(o => o.name.toLowerCase().includes(q)) : orgs;
  }, [orgs, query]);

  const pickOrg = async (org: OrgOption) => {
    setPickedOrg(org);
    setMembers(null);
    setQuery('');
    const { data: rows } = await supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id);
    const ids = (rows || []).map((r: any) => r.user_id);
    const { data: profiles } = ids.length
      ? await (supabase as any).from('profiles').select('id, full_name, email, default_location_context, default_company_id').in('id', ids)
      : { data: [] };
    const byId = new Map((profiles || []).map((p: any) => [p.id, p]));
    setMembers((rows || []).map((r: any) => {
      const p: any = byId.get(r.user_id) ?? {};
      return {
        userId: r.user_id,
        name: p.full_name?.trim() || p.email || 'Member',
        role: r.role,
        defaultLocation: p.default_location_context ?? null,
        defaultCompanyId: p.default_company_id ?? null,
      };
    }).sort((a: ViewAsMember, b: ViewAsMember) => a.name.localeCompare(b.name)));
  };

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? (members || []).filter(m => m.name.toLowerCase().includes(q)) : members || [];
  }, [members, query]);

  const openOrg = async (org: OrgOption, member?: ViewAsMember) => {
    setOpeningId(member?.userId ?? org.id);
    setError(null);
    try {
      const ok = await viewAsOrganization(org.id, member);
      if (!ok) {
        setError(`${org.name} has no companies yet`);
        return;
      }
      onOpenChange(false);
      navigate('/dashboard');
    } catch (e) {
      console.error('Failed to open organization dashboard:', e);
      setError('Could not open that organization');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>View dashboard as</DialogTitle>
          <DialogDescription>
            {pickedOrg
              ? 'Open it as the whole organization, or as one member to see their default view (read only).'
              : 'Choose an organization to open its dashboard.'}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={pickedOrg ? 'Search members' : 'Search organizations'}
            className="pl-9"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="max-h-80 overflow-y-auto -mx-1">
          {pickedOrg ? (
            <>
              <button
                onClick={() => { setPickedOrg(null); setQuery(''); }}
                className="mb-1 flex items-center gap-1.5 px-3 py-1 text-xs text-slate-500 hover:text-slate-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {pickedOrg.name}
              </button>
              <button
                onClick={() => openOrg(pickedOrg)}
                disabled={openingId !== null}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" />Whole organization</span>
                {openingId === pickedOrg.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </button>
              {members === null ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : filteredMembers.map(m => (
                <button
                  key={m.userId}
                  onClick={() => openOrg(pickedOrg, m)}
                  disabled={openingId !== null}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <User className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {[m.role, m.defaultLocation].filter(Boolean).join(' · ')}
                  </span>
                  {openingId === m.userId && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </button>
              ))}
            </>
          ) : loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No organizations found</p>
          ) : (
            filtered.map(org => (
              <button
                key={org.id}
                onClick={() => pickOrg(org)}
                disabled={openingId !== null}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="truncate">{org.name}</span>
                {openingId === org.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
