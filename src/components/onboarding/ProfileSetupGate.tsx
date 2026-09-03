import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { canonicalizeLocationContext } from '@/utils/locationContext';
import {
  brandForCompanyId,
  completeProfileSetup,
  locationRawValue,
  profileSetupMetadata,
  profileSetupQueryKey,
  representativeCompanyId,
  useOrgBrands,
  useOrgLocationOptions,
  useProfileSetupStatus,
  validLocationKey,
  type OrgBrand,
  type ProfileSetupStatus,
} from '@/hooks/useProfileSetup';
import { CompanyBrandSelect } from './CompanyBrandSelect';
import { LocationSelect } from './LocationSelect';

const PAGE_BG = 'linear-gradient(135deg, #f7dee7 0%, #fbeaf0 45%, #eef1f8 100%)';
const sans = { fontFamily: 'Plus Jakarta Sans, sans-serif' };
const display = { fontFamily: 'Geologica, sans-serif' };
const inputClass =
  'h-11 rounded-xl border-gray-200 bg-white placeholder:text-gray-300 placeholder:font-light focus-visible:ring-2 focus-visible:ring-pink/25 focus-visible:border-pink transition';

// First-login setup for signed-in users who never completed it: accounts
// provisioned by an admin, SSO / One Tap signups, intake-approved clients —
// anyone who did not come in through /welcome (invited teammates answer the
// same questions there, so they never see this). Existing users were
// backfilled as complete when the columns were added.
export const ProfileSetupGate = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const status = useProfileSetupStatus(user?.id);

  if (!user) return <>{children}</>;
  if (status.isPending) return <LoadingScreen />;
  // Fail open: a profile read error must never lock someone out of the app.
  if (status.isError || status.data?.onboardingCompletedAt) return <>{children}</>;

  return <ProfileSetupScreen user={user} initial={status.data} />;
};

const ProfileSetupScreen = ({
  user,
  initial,
}: {
  user: User;
  initial: ProfileSetupStatus | undefined;
}) => {
  const queryClient = useQueryClient();
  const brandsQuery = useOrgBrands(user.id);
  const brands = brandsQuery.data?.brands ?? [];
  const [brandKey, setBrandKey] = useState<string | null>(null);
  // Subsidiary in play: the user's pick, else the one their saved company
  // belongs to, else the org's main brand. `undefined` while brands load
  // keeps the country query pending.
  const brand: OrgBrand | null | undefined = brandsQuery.isPending
    ? undefined
    : (brandKey ? brands.find((b) => b.key === brandKey) : undefined) ??
      brandForCompanyId(brands, initial?.defaultCompanyId) ??
      brands[0] ??
      null;
  const locationsQuery = useOrgLocationOptions(user.id, brand);
  const locationOptions = locationsQuery.data ?? [];
  const locationsPending = locationsQuery.isPending;

  const [fullName, setFullName] = useState(
    initial?.fullName || (user.user_metadata?.full_name as string | undefined) || '',
  );
  const [location, setLocation] = useState<string | null>(() =>
    canonicalizeLocationContext(initial?.defaultLocationContext),
  );
  const [saving, setSaving] = useState(false);

  const chooseBrand = (key: string) => {
    setBrandKey(key);
    setLocation(null); // countries belong to a subsidiary; start over
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = fullName.trim();
    if (!name) {
      toast.error('Please enter your name');
      return;
    }
    const locationKey = validLocationKey(location, locationOptions);
    setSaving(true);
    try {
      // Session copy first (drives the dashboard on this device), then the
      // durable profile columns + completion stamp.
      const { error: metaError } = await supabase.auth.updateUser({
        data: { full_name: name, ...profileSetupMetadata(locationKey, locationOptions, brand) },
      });
      if (metaError) throw metaError;
      await completeProfileSetup({ fullName: name, locationKey, options: locationOptions, brand });
      queryClient.setQueryData<ProfileSetupStatus>(profileSetupQueryKey(user.id), {
        fullName: name,
        defaultLocationContext: locationRawValue(locationKey, locationOptions),
        defaultCompanyId: representativeCompanyId(brand, locationKey),
        onboardingCompletedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      console.error('Profile setup failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not save your details');
    } finally {
      setSaving(false);
    }
  };

  const showFocus = brands.length > 1 || locationsPending || locationOptions.length > 0;

  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-6" style={{ background: PAGE_BG }}>
      <div className="w-full max-w-[420px] bg-white rounded-3xl shadow-[0_24px_70px_-20px_rgba(19,39,79,0.3)] overflow-hidden">
        <div className="bg-gradient-to-br from-pink/15 via-white to-[#13274F]/5 px-8 pt-9 pb-7 text-center border-b border-gray-100/80">
          <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-5 mx-auto mb-6" />
          <h1 className="text-[24px] font-bold text-nightsky leading-tight" style={display}>
            Welcome to PerceptionX
          </h1>
          <p className="mt-3 text-[14px] text-nightsky/60" style={sans}>
            A couple of quick questions so your dashboard opens on what matters to you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-7 space-y-5" style={sans}>
          <div className="space-y-1.5">
            <label htmlFor="setup-fullName" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Your name
            </label>
            <Input
              id="setup-fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="First and last name"
              autoComplete="name"
              className={inputClass}
              autoFocus
              required
            />
          </div>

          {showFocus && (
            <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
              <p className="text-[13px] font-semibold text-nightsky">What do you want to focus on first?</p>

              {brands.length > 1 && (
                <div className="space-y-1.5">
                  <label htmlFor="setup-company" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Subsidiary
                  </label>
                  <CompanyBrandSelect
                    id="setup-company"
                    brands={brands}
                    value={brand?.key ?? null}
                    onChange={chooseBrand}
                    disabled={saving}
                    className={inputClass}
                  />
                </div>
              )}

              {(locationsPending || locationOptions.length > 0) && (
                <div className="space-y-1.5">
                  <label htmlFor="setup-location" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Country
                  </label>
                  <LocationSelect
                    id="setup-location"
                    options={locationOptions}
                    value={location}
                    onChange={setLocation}
                    loading={locationsPending}
                    disabled={saving}
                    className={inputClass}
                  />
                </div>
              )}

              <p className="text-[11px] text-gray-400 leading-relaxed">
                Your dashboard opens here. Change it any time from your account.
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={saving || locationsPending || !fullName.trim()}
            className="w-full h-11 bg-pink hover:bg-pink/90 text-white rounded-full font-bold text-[15px] disabled:opacity-50 group"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving…
              </>
            ) : (
              <>
                Go to my dashboard
                <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};
