import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { LocationSelect } from '@/components/onboarding/LocationSelect';
import {
  fetchOrgLocationOptions,
  locationRawValue,
  representativeCompanyId,
  validLocationKey,
  type OrgBrand,
} from '@/hooks/useProfileSetup';
import { canonicalizeLocationContext } from '@/utils/locationContext';
import { brandForCompany, type MemberFocus } from './memberFocus';
import { toast } from 'sonner';

// Radix Select forbids an empty-string item value.
const ALL_BRANDS = '__all__';

export interface MemberFocusDialogMember extends MemberFocus {
  id: string; // organization_members.id
  email: string;
  quarterlyDigest: boolean;
}

interface MemberFocusDialogProps {
  orgId: string;
  brands: OrgBrand[];
  member: MemberFocusDialogMember | null;
  onClose: () => void;
  // Called with the saved values so the table updates without a reload.
  onSaved: (next: MemberFocusDialogMember) => void;
}

// Admin editor for one member's quarterly email settings: on the send list
// or not, and the view the email (and their dashboard) is scoped to. The
// view is the member's profile focus, written through admin_set_member_focus
// exactly as the Account page writes it for oneself.
export const MemberFocusDialog = ({ orgId, brands, member, onClose, onSaved }: MemberFocusDialogProps) => {
  const [brandKey, setBrandKey] = useState<string>(ALL_BRANDS);
  const [location, setLocation] = useState<string | null>(null);
  const [digest, setDigest] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset the form each time a member is opened.
  useEffect(() => {
    if (!member) return;
    setBrandKey(brandForCompany(brands, member.defaultCompanyId)?.key ?? ALL_BRANDS);
    setLocation(canonicalizeLocationContext(member.defaultLocationContext));
    setDigest(member.quarterlyDigest);
  }, [member, brands]);

  const brand: OrgBrand | null = brandKey === ALL_BRANDS ? null : brands.find((b) => b.key === brandKey) ?? null;

  const locationsQuery = useQuery({
    queryKey: ['admin', 'member-focus', 'locations', orgId, brand?.key ?? 'org'],
    enabled: !!member,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchOrgLocationOptions(orgId, brand),
  });
  const locationOptions = locationsQuery.data ?? [];

  const chooseBrand = (key: string) => {
    setBrandKey(key);
    setLocation(null); // markets belong to a subsidiary; start over
  };

  const handleSave = async () => {
    if (!member) return;
    setSaving(true);
    try {
      const locationKey = validLocationKey(location, locationOptions);
      const { data, error } = await supabase.rpc('admin_set_member_focus' as never, {
        p_member_id: member.id,
        p_default_company_id: representativeCompanyId(brand, locationKey),
        p_default_location_context: locationRawValue(locationKey, locationOptions),
        p_quarterly_digest: digest,
      } as never);
      if (error) throw error;
      const row = (data ?? {}) as { quarterly_digest?: boolean; default_company_id?: string | null; default_location_context?: string | null };
      onSaved({
        ...member,
        quarterlyDigest: row.quarterly_digest ?? digest,
        defaultCompanyId: row.default_company_id ?? null,
        defaultLocationContext: row.default_location_context ?? null,
      });
      toast.success(`Saved ${member.email}`);
      onClose();
    } catch (err) {
      console.error('admin_set_member_focus failed', err);
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quarterly email</DialogTitle>
          <DialogDescription>
            {member?.email}. The view below is what their dashboard opens on and what their quarterly email covers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-md border border-silver px-3 py-2">
            <div>
              <Label htmlFor="member-digest" className="text-sm font-medium">On the send list</Label>
              <p className="text-xs text-slate-500">Only ticked members receive the quarterly update.</p>
            </div>
            <Switch id="member-digest" checked={digest} onCheckedChange={setDigest} />
          </div>

          {brands.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="member-brand">Brand</Label>
              <Select value={brandKey} onValueChange={chooseBrand}>
                <SelectTrigger id="member-brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANDS}>All brands</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="member-location">Markets</Label>
            <LocationSelect
              id="member-location"
              options={locationOptions}
              value={location}
              onChange={setLocation}
              loading={locationsQuery.isPending}
            />
            <p className="text-xs text-slate-500">One market, a region, or any combination. Leave as all for the whole brand.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || locationsQuery.isPending}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
