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
import { CompanyStep } from './CompanyStep';
import { CountryStep } from './CountryStep';
import { SetupStepper, setupDisplay, setupInputClass, setupSans } from './SetupStepper';

// First-login setup for signed-in users who never completed it: accounts
// provisioned by an admin, SSO / One Tap signups, intake-approved clients,
// and invitees who set a password on /welcome but stopped before the focus
// questions. Existing users were backfilled as complete when the columns
// were added.
export const ProfileSetupGate = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const status = useProfileSetupStatus(user?.id);

  if (!user) return <>{children}</>;
  if (status.isPending) return <LoadingScreen />;
  // Fail open: a profile read error must never lock someone out of the app.
  if (status.isError || status.data?.onboardingCompletedAt) return <>{children}</>;

  return <ProfileSetupScreen user={user} initial={status.data} />;
};

type StepId = 'about' | 'company' | 'country';

const primaryButtonClass =
  'w-full h-11 bg-pink hover:bg-pink/90 text-white rounded-full font-bold text-[15px] disabled:opacity-50 group';

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

  // One question per step. The company step only exists for multi-brand
  // orgs; the country step is always there (it explains itself when the
  // company has no country data).
  const steps: StepId[] = ['about', ...(brands.length > 1 ? (['company'] as StepId[]) : []), 'country'];
  const [step, setStep] = useState<StepId>('about');
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLast = stepIndex === steps.length - 1;
  const goNext = () => setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  const goBack = () => setStep(steps[Math.max(stepIndex - 1, 0)]);

  const [fullName, setFullName] = useState(
    initial?.fullName || (user.user_metadata?.full_name as string | undefined) || '',
  );
  // Company: a previously saved choice is preselected (once brands load),
  // otherwise the user has to pick. Single-brand orgs skip the step and that
  // brand is implied.
  const [pickedBrandKey, setPickedBrandKey] = useState<string | null>(null);
  const brandKey =
    pickedBrandKey ?? brandForCompanyId(brands, initial?.defaultCompanyId)?.key ?? null;
  const brand: OrgBrand | null | undefined = brandsQuery.isPending
    ? undefined
    : brands.length <= 1
      ? brands[0] ?? null
      : brandKey
        ? brands.find((b) => b.key === brandKey) ?? null
        : undefined; // multi-brand org, nothing chosen yet → country list waits
  const locationsQuery = useOrgLocationOptions(user.id, brand);
  const locationOptions = locationsQuery.data ?? [];

  // Country: undefined until the user picks; null = "All countries", chosen.
  const [location, setLocation] = useState<string | null | undefined>(() => {
    const saved = canonicalizeLocationContext(initial?.defaultLocationContext);
    return saved ?? undefined;
  });
  const [saving, setSaving] = useState(false);

  const chooseBrand = (key: string) => {
    setPickedBrandKey(key);
    if (key !== brandKey) setLocation(undefined); // countries belong to a company; choose again
    goNext();
  };

  const finish = async () => {
    const name = fullName.trim();
    if (!name) {
      toast.error('Please enter your name');
      setStep('about');
      return;
    }
    const chosenBrand = brand ?? null;
    const locationKey = validLocationKey(location ?? null, locationOptions);
    setSaving(true);
    try {
      // Session copy first (drives the dashboard on this device), then the
      // durable profile columns + completion stamp.
      const { error: metaError } = await supabase.auth.updateUser({
        data: { full_name: name, ...profileSetupMetadata(locationKey, locationOptions, chosenBrand) },
      });
      if (metaError) throw metaError;
      await completeProfileSetup({ fullName: name, locationKey, options: locationOptions, brand: chosenBrand });
      queryClient.setQueryData<ProfileSetupStatus>(profileSetupQueryKey(user.id), {
        fullName: name,
        defaultLocationContext: locationRawValue(locationKey, locationOptions),
        defaultCompanyId: representativeCompanyId(chosenBrand, locationKey),
        onboardingCompletedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      console.error('Profile setup failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not save your details');
    } finally {
      setSaving(false);
    }
  };

  const hero = (
    <>
      <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-5 mx-auto mb-5" />
      <h1 className="text-[22px] font-bold text-nightsky leading-tight" style={setupDisplay}>
        Welcome to PerceptionX
      </h1>
      <p className="mt-2 text-[13px] text-nightsky/60" style={setupSans}>
        A few quick questions so your dashboard opens on what matters to you.
      </p>
    </>
  );

  const finishButton = (label: string, disabled: boolean) => (
    <Button type="button" onClick={finish} disabled={disabled || saving} className={primaryButtonClass}>
      {saving ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Saving…
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
        </>
      )}
    </Button>
  );

  if (step === 'about') {
    const canContinue = !!fullName.trim() && !brandsQuery.isPending;
    return (
      <SetupStepper
        hero={hero}
        stepIndex={stepIndex}
        stepCount={steps.length}
        title="First, your name"
        subtitle="This is how teammates will see you."
        action={
          isLast ? (
            finishButton('Go to my dashboard', !canContinue)
          ) : (
            <Button type="button" onClick={goNext} disabled={!canContinue} className={primaryButtonClass}>
              Continue
              <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </Button>
          )
        }
      >
        <div className="space-y-1.5">
          <label htmlFor="setup-fullName" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Your name
          </label>
          <Input
            id="setup-fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canContinue && !isLast) {
                e.preventDefault();
                goNext();
              }
            }}
            placeholder="First and last name"
            autoComplete="name"
            className={setupInputClass}
            autoFocus
            required
          />
        </div>
      </SetupStepper>
    );
  }

  if (step === 'company') {
    return (
      <SetupStepper
        hero={hero}
        stepIndex={stepIndex}
        stepCount={steps.length}
        title="Which company do you work with?"
        subtitle="Your dashboard opens on this company. You can switch companies any time."
        onBack={goBack}
        action={
          <Button type="button" onClick={goNext} disabled={!brandKey} className={primaryButtonClass}>
            Continue
            <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
          </Button>
        }
      >
        <CompanyStep brands={brands} value={brandKey} onSelect={chooseBrand} disabled={saving} />
      </SetupStepper>
    );
  }

  const countriesLoading = locationsQuery.isPending;
  const noCountries = locationsQuery.isSuccess && locationOptions.length === 0;
  const chosen = location !== undefined || noCountries;
  return (
    <SetupStepper
      hero={hero}
      stepIndex={stepIndex}
      stepCount={steps.length}
      title="Which country do you focus on first?"
      subtitle="Pick one to open on, or all countries. Change it any time from your account."
      onBack={goBack}
      action={finishButton('Go to my dashboard', countriesLoading || !chosen)}
    >
      <CountryStep
        options={locationOptions}
        loading={countriesLoading}
        value={location}
        onSelect={setLocation}
        disabled={saving}
      />
    </SetupStepper>
  );
};
