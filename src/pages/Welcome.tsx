import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Check, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { LocationPreferenceField } from '@/components/onboarding/LocationPreferenceField';
import { completeProfileSetup, profileSetupMetadata, useOrgLocationOptions } from '@/hooks/useProfileSetup';

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

const PAGE_BG =
  'linear-gradient(135deg, #f7dee7 0%, #fbeaf0 45%, #eef1f8 100%)';

const sans = { fontFamily: 'Plus Jakarta Sans, sans-serif' };
const display = { fontFamily: 'Geologica, sans-serif' };

// Landing page for team invites: the email's action link signs the invitee in
// and redirects here so they can set a password before entering the dashboard.
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
  // Canonical key of the location the invitee wants the dashboard to open on;
  // null = "All locations". Options span the organization the invite created
  // the membership in, so they match the dashboard's location filter.
  const [location, setLocation] = useState<string | null>(null);
  const { data: locationOptions = [], isLoading: locationsLoading } = useOrgLocationOptions(user?.id);

  // New flow: exchange a durable invite token (?invite=…) for a fresh session.
  // The redeem-invite function mints a one-time OTP we verify here, so the
  // emailed link lives for 30 days (resending restarts the window) — and stops
  // working once accepted or revoked.
  useEffect(() => {
    if (!inviteToken) return;
    if (user) {
      setSessionStatus('valid');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('redeem-invite', {
          body: { token: inviteToken },
        });
        if (error) throw error;
        if (!data?.ok || !data?.tokenHash) {
          if (!cancelled) {
            setExpiredReason(
              data?.reason === 'used' ? 'used' : data?.reason === 'expired' ? 'expired' : 'invalid',
            );
            setSessionStatus('expired');
          }
          return;
        }
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: data.tokenHash,
          type: 'magiclink',
        });
        if (otpError) throw otpError;
        if (cancelled) return;
        setSessionStatus('valid');
        // Don't leave the token sitting in the URL / browser history.
        searchParams.delete('invite');
        setSearchParams(searchParams, { replace: true });
      } catch (err) {
        console.error('Invite redemption failed:', err);
        if (!cancelled) {
          setExpiredReason('invalid');
          setSessionStatus('expired');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken, user]);

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

  useEffect(() => {
    if (user) setSessionStatus('valid');
  }, [user]);

  const inviterName = (user?.user_metadata?.inviter_name as string) || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    const locationEntry = locationOptions.find((o) => o.canonicalKey === location) ?? null;

    setLoading(true);
    try {
      // Password plus session metadata (name, default location) in one call.
      const { error } = await supabase.auth.updateUser({
        password,
        data: { full_name: name, ...profileSetupMetadata(locationEntry) },
      });
      if (error) throw error;

      // Keep the app-facing profile in sync — the name is what teammates see
      // in invite emails when this user invites others later — and stamp
      // first-login setup complete so the dashboard gate never shows it.
      await completeProfileSetup({ fullName: name, location: locationEntry });

      toast.success("You're all set — welcome to PerceptionX!");
      navigate('/dashboard');
    } catch (error: any) {
      console.error('Error setting password:', error);
      toast.error(error.message || 'Failed to set password');
    } finally {
      setLoading(false);
    }
  };

  if (sessionStatus === 'checking') {
    return <LoadingScreen />;
  }

  if (sessionStatus === 'expired') {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center p-6" style={{ background: PAGE_BG }}>
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

  const requirements = [
    { ok: password.length >= PASSWORD_MIN_LENGTH, label: 'At least 8 characters' },
    { ok: /[A-Z]/.test(password), label: 'One uppercase letter' },
    { ok: /[a-z]/.test(password), label: 'One lowercase letter' },
    { ok: /[0-9]/.test(password), label: 'One number' },
  ];
  const passwordValid = !validatePassword(password);
  const canSubmit = !!fullName.trim() && passwordValid;

  const inputClass =
    'h-11 rounded-xl border-gray-200 bg-white placeholder:text-gray-300 placeholder:font-light focus-visible:ring-2 focus-visible:ring-pink/25 focus-visible:border-pink transition';

  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-6" style={{ background: PAGE_BG }}>
      <div className="w-full max-w-[420px] bg-white rounded-3xl shadow-[0_24px_70px_-20px_rgba(19,39,79,0.3)] overflow-hidden">
        {/* Hero */}
        <div className="bg-gradient-to-br from-pink/15 via-white to-[#13274F]/5 px-8 pt-9 pb-7 text-center border-b border-gray-100/80">
          <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-5 mx-auto mb-6" />
          <h1 className="text-[24px] font-bold text-nightsky leading-tight" style={display}>
            Welcome to the team
          </h1>

          {inviterName && (
            <div className="mt-4 inline-flex items-center gap-2.5 rounded-full bg-white border border-gray-100 pl-1.5 pr-4 py-1.5 shadow-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink text-white text-[11px] font-bold flex-shrink-0">
                {initialsOf(inviterName)}
              </span>
              <span className="text-[13px] text-nightsky/80 leading-tight text-left" style={sans}>
                <span className="font-semibold text-nightsky">{inviterName}</span> invited you to join them
              </span>
            </div>
          )}

          <p className="mt-3 text-[14px] text-nightsky/60" style={sans}>
            Add your details and get started instantly.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-7 space-y-5" style={sans}>
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
              className={inputClass}
              required
            />
          </div>

          {(locationsLoading || locationOptions.length > 0) && (
            <div className="space-y-1.5">
              <label htmlFor="location" className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Which location do you focus on?
              </label>
              <LocationPreferenceField
                id="location"
                options={locationOptions}
                value={location}
                onChange={setLocation}
                loading={locationsLoading}
                disabled={loading}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Your dashboard will open on this location. Change it any time from your account.
              </p>
            </div>
          )}

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
                className={`${inputClass} pr-11`}
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

          <Button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full h-11 bg-pink hover:bg-pink/90 text-white rounded-full font-bold text-[15px] disabled:opacity-50 group"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Setting up your account…
              </>
            ) : (
              <>
                Set password &amp; continue
                <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </form>

        {/* Footer */}
        <div className="px-8 pb-7 -mt-2 flex items-center justify-center gap-5">
          <a href="https://perceptionx.ai/privacy" target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-nightsky transition">
            Privacy
          </a>
          <span className="h-3 w-px bg-gray-200" />
          <a href="https://perceptionx.ai/terms" target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:text-nightsky transition">
            Terms
          </a>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
