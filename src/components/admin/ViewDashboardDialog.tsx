import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompany } from '@/contexts/CompanyContext';
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
export const ViewDashboardDialog = ({ open, onOpenChange }: ViewDashboardDialogProps) => {
  const navigate = useNavigate();
  const { switchCompany } = useCompany();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuery('');
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

  const openOrg = async (org: OrgOption) => {
    setOpeningId(org.id);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('organization_companies')
        .select('companies(id, name, country)')
        .eq('organization_id', org.id);
      if (err) throw err;

      const companies = (data ?? [])
        .map(row => (Array.isArray(row.companies) ? row.companies[0] : row.companies))
        .filter(Boolean) as { id: string; name: string; country: string | null }[];
      if (companies.length === 0) {
        setError(`${org.name} has no companies yet`);
        return;
      }

      const target = companies.find(c => c.country === 'US') ?? companies[0];
      await switchCompany(target.id);
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
          <DialogDescription>Choose an organization to open its dashboard.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search organizations"
            className="pl-9"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="max-h-80 overflow-y-auto -mx-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No organizations found</p>
          ) : (
            filtered.map(org => (
              <button
                key={org.id}
                onClick={() => openOrg(org)}
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
