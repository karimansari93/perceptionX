import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Check, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { CompanyStep } from '@/components/onboarding/CompanyStep';
import { CountryStep } from '@/components/onboarding/CountryStep';
import {
  SETUP_PAGE_BG,
  SetupStepper,
  setupDisplay,
  setupInputClass,
  setupSans,
} from '@/components/onboarding/SetupStepper';
import {
  completeProfileSetup,
  profileSetupMetadata,
  useOrgBrands,
  useOrgLocationOptions,
  validLocationKey,
  type OrgBrand,
} from '@/hooks/useProfileSetup';

const PASSWORD_MIN_LENGTH = 8;

const validatePassword = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const sans = setupSans;
const display = setupDisplay;

type StepId = 'about' | 'company' | 'country';

const primaryButtonClass =
  'w-full h-11 bg-pink hover:bg-pink/90 text-white rounded-full font-bold text-[15px] disabled:opacity-50 group';

// Landing page for team invites: the email's link signs the invitee in and
// brings them here for a short step-by-step setup — name and password first
// (saved immediately, so stopping here still leaves a working login), then
// "what do you want to focus on first?": company (multi-brand orgs) and
// country. Anyone who stops after step one gets the remaining questions from
// the ProfileSetupGate on their next visit.
const Welcome = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'checking' | 'valid' | 'expired'>('checking');
  const [expiredReason, setExpiredReason] = useState<'used' | 'invalid' | 'expired' | null>(null);

  // "What do you want to focus on first?": one company (when the org has
  // several) and one country. Country options are scoped to the company and
  // match the dashboard's location filter; the dashboard lands there.
  // `brand` stays undefined (and the country list pending) until brands load
  // or, in a multi-brand org, until the company is chosen.
  const brandsQuery = useOrgBrands(user?.id);
  const brands = brandsQuery.data?.brands ?? [];
  const [brandKey, setBrandKey] = useState<string | null>(null);
  const brand: OrgBrand | null | undefined = brandsQuery.isPending
    ? undefined
    : brands.length <= 1
      ? brands[0] ?? null
      : brandKey
        ? brands.find((b) => b.key === brandKey) ?? null
        : undefined;
  const locationsQuery = useOrgLocationOptions(user?.id, brand);
  const locationOptions = locationsQuery.data ?? [];
  // undefined until the invitee picks; null = "All countries", chosen.
  const [location, setLocation] = useState<string | null | undefined>(undefined);

  // One question per step.
  const steps: StepId[] = ['about', ...(brands.length > 1 ? (['company'] as StepId[]) : []), 'country'];
  const [step, setStep] = useState<StepId>('about');
  const stepIndex = Math.max(0, steps.indexOf(step));
  const goNext = () => setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  const goBack = () => setStep(steps[Math.max(stepIndex - 1, 0)]);

  // New flow: exchange a durable invite token (?invite=…) for a fresh session.
  // The redeem-invite function mints a one-time OTP we verify here, so the
  // emailed link lives for 30 days (resending restarts the window) — and stops
  // working once accepted or revoked.
  //
  // Runs once per token, regardless of any session already in this browser.
  // An invite link opened while someone else is signed in (a shared machine,
  // or the admin who sent it clicking it themselves) must NOT hand that
  // person the invitee's form — it would rewrite their name, password and
  // dashboard focus. That session is dropped (this browser only) before the
  // token is redeemed.
  const redeemState = useRef<'idle' | 'redeeming' | 'done'>('idle');
  useEffect(() => {
    if (!inviteToken) return;
    if (redeemState.current !== 'idle') return;
    redeemState.current = 'redeeming';
    (async () => {
      try {
        const { data: { session: existing } } = await supabase.auth.getSession();
        if (existing) await supabase.auth.signOut({ scope: 'local' });
        const { data, error } = await supabase.functions.invoke('redeem-invite', {
          body: { token: inviteToken },
        });
        if (error) throw error;
        if (!data?.ok || !data?.tokenHash) {
          setExpiredReason(
            data?.reason === 'used' ? 'used' : data?.reason === 'expired' ? 'expired' : 'invalid',
          );
          setSessionStatus('expired');
          return;
        }
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash,
          type: 'magiclink',
        });
        if (otpError) throw otpError;
        redeemState.current = 'done';
        setSessionStatus('valid');
        // Don't leave the token sitting in the URL / browser history.
        searchParams.delete('invite');
        setSearchParams(searchParams, { replace: true });
      } catch (err) {
        console.error('Invite redemption failed:', err);
        setExpiredReason('invalid');
        setSessionStatus('expired');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  // Legacy flow (Supabase auth action link drops the session in the URL hash),
  // or a bare /welcome visit: fall back to the previous session probe. Skipped
  // entirely when a token is present — the redemption effect owns the status.
  useEffect(() => {
    if (inviteToken) return;
    if (authLoading) return;
    if (user) {
      setSessionStatus('valid');
      return;
    }
    const timeout = setTimeout(() => {
      setSessionStatus((prev) => (prev === 'valid' ? 'valid' : 'expired'));
    }, 3000);
    return () => clearTimeout(timeout);
  }, [user, authLoading, inviteToken]);

  // A session only counts once the token (if any) has been redeemed — the
  // pre-existing session of someone else must not unlock the form.
  useEffect(() => {
    if (user && (!inviteToken || redeemState.current === 'done')) setSessionStatus('valid');
  }, [user, inviteToken]);

  const inviterName = (user?.user_metadata?.inviter_name as string) || null;

  const requirements = [
    { ok: password.length >= PASSWORD_MIN_LENGTH, label: 'At least 8 characters' },
    { ok: /[A-Z]/.test(password), label: 'One uppercase letter' },
    { ok: /[a-z]/.test(password), label: 'One lowercase letter' },
    { ok: /[0-9]/.test(password), label: 'One number' },
  ];
  const passwordValid = !validatePassword(password);
  const canContinueAbout = !!fullName.trim() && passwordValid && !brandsQuery.isPending;

  // Step 1: save the login right away, so someone who stops here still has
  // an account (the setup gate asks the rest on their next visit).
  const saveCredentials = async () => {
    const name = fullName.trim();
    if (!name) {
      toast.error('Please enter your name');
      return;
    }
    const validationError = validatePassword(password);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { full_name: name },
      });
      if (error) throw error;
      // Keep the app-facing profile in sync — the name is what teammates see
      // in invite emails when this user invites others later.
      if (user) {
        await supabase.from('profiles').update({ full_name: name }).eq('id', user.id);
      }
      goNext();
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast.error(error.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  const chooseBrand = (key: string) => {
    setBrandKey(key);
    setLocation(undefined); // countries belong to a company; choose again
    goNext();
  };

  // Last step: company + country into the session and the profile, and
  // stamp first-login setup complete so the dashboard gate never shows it.
  const finish = async () => {
    const name = fullName.trim();
    const chosenBrand = brand ?? null;
    const locationKey = validLocationKey(location ?? null, locationOptions);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name, ...profileSetupMetadata(locationKey, locationOptions, chosenBrand) },
      });
      if (error) throw error;
      await completeProfileSetup({ fullName: name, locationKey, options: locationOptions, brand: chosenBrand });

      toast.success("You're all set — welcome to PerceptionX!");
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Error finishing setup:', error);
      toast.error(error.message || 'Could not save your details');
    } finally {
      setLoading(false);
    }
  };

  if (sessionStatus === 'checking') {
    return <LoadingScreen />;
  }

  if (sessionStatus === 'expired') {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center p-6" style={{ background: SETUP_PAGE_BG }}>
        <div className="w-full max-w-[420px] bg-white rounded-3xl shadow-[0_24px_70px_-20px_rgba(19,39,79,0.3)] overflow-hidden text-center">
          <div className="bg-gradient-to-br from-pink/15 via-white to-[#13274F]/5 px-8 pt-9 pb-7">
            <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-5 mx-auto mb-6" />
            <h1 className="text-[22px] font-bold text-nightsky leading-tight" style={display}>
              {expiredReason === 'used'
                ? "You're already set up"
                : expiredReason === 'expired'
                  ? 'Invite link expired'
                  : 'Invite link not valid'}
            </h1>
          </div>
          <div className="px-8 py-7 space-y-5">
            <p className="text-[14px] text-nightsky/70 leading-relaxed" style={sans}>
              {expiredReason === 'used'
                ? 'This invite has already been accepted. If that was you, just log in with your email and password.'
                : expiredReason === 'expired'
                  ? 'This invite link has expired. Ask your teammate to resend it from their dashboard — a resent invite is good for another 30 days.'
                  : 'This invite link is no longer valid or was cancelled. Ask your teammate to send you a new one from their dashboard.'}
            </p>
            <Button
              onClick={() => navigate('/auth')}
              className="w-full h-11 bg-nightsky hover:bg-nightsky/90 text-white rounded-full font-bold text-[15px]"
              style={sans}
            >
              Back to login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const hero = (
    <>
      <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-5 mx-auto mb-5" />
      <h1 className="text-[22px] font-bold text-nightsky leading-tight" style={display}>
        Welcome to the team
      </h1>
      {inviterName && (
        <div className="mt-3 inline-flex items-center gap-2.5 rounded-full bg-white border border-gray-100 pl-1.5 pr-4 py-1.5 shadow-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink text-white text-[11px] font-bold flex-shrink-0">
            {initialsOf(inviterName)}
          </span>
          <span className="text-[13px] text-nightsky/80 leading-tight text-left" style={sans}>
            <span className="font-semibold text-nightsky">{inviterName}</span> invited you to join them
          </span>
        </div>
      )}
    </>
  );

  const footnote = (
    <div className="flex items-center justify-center gap-5">
      <a href="https://perceptionx.ai/privacy" target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-nightsky transition">
        Privacy
      </a>
      <span className="h-3 w-px bg-gray-200" />
      <a href="https://perceptionx.ai/terms" target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-nightsky transition">
        Terms
      </a>
    </div>
  );

  if (step === 'about') {
    return (
      <SetupStepper
        hero={hero}
        stepIndex={stepIndex}
        stepCount={steps.length}
        title="First, your details"
        subtitle="Your name and a password for your account."
        footnote={footnote}
        action={
          <Button type="submit" form="welcome-about" disabled={loading || !canContinueAbout} className={primaryButtonClass}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving…
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        }
      >
        <form
          id="welcome-about"
          onSubmit={(e) => {
            e.preventDefault();
            void saveCredentials();
          }}
          className="space-y-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="fullName" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Your name
            </label>
            <Input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="First and last name"
              autoComplete="name"
              className={setupInputClass}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                autoComplete="new-password"
                className={`${setupInputClass} pr-11`}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-nightsky transition"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password.length > 0 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2">
                {requirements.map((r) => (
                  <div key={r.label} className="flex items-center gap-1.5">
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full flex-shrink-0 transition ${
                        r.ok ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-300'
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    <span className={`text-[11px] transition ${r.ok ? 'text-green-700' : 'text-gray-400'}`}>
                      {r.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
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
        footnote={footnote}
        action={
          <Button type="button" onClick={goNext} disabled={!brandKey} className={primaryButtonClass}>
            Continue
            <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
          </Button>
        }
      >
        <CompanyStep brands={brands} value={brandKey} onSelect={chooseBrand} disabled={loading} />
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
      footnote={footnote}
      action={
        <Button
          type="button"
          onClick={finish}
          disabled={loading || countriesLoading || !chosen}
          className={primaryButtonClass}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Setting up your dashboard…
            </>
          ) : (
            <>
              Go to my dashboard
              <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      }
    >
      <CountryStep
        options={locationOptions}
        loading={countriesLoading}
        value={location}
        onSelect={setLocation}
        disabled={loading}
      />
    </SetupStepper>
  );
};

export default Welcome;
