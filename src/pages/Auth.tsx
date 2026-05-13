import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, ArrowRight, Sparkles, BarChart3, Target, Users, Mail, Medal, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingModal } from '@/components/prompts/LoadingModal';
import { generateAndInsertPrompts, ProgressInfo } from '@/hooks/usePromptsLogic';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { validateEmail, sanitizeInput, logger } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Google Material Button component
const GoogleMaterialButton = ({ onClick, loading, mode }) => (
  <button
    type="button"
    className="gsi-material-button w-full mb-2"
    onClick={onClick}
    disabled={loading}
    style={{
      display: 'flex',
      alignItems: 'center',
      border: 'none',
      borderRadius: '28px',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(60,64,67,.3),0 1.5px 6px 1px rgba(60,64,67,.15)',
      height: '56px',
      cursor: loading ? 'not-allowed' : 'pointer',
      opacity: loading ? 0.7 : 1,
      padding: 0,
    }}
  >
    <div className="gsi-material-button-state" />
    <div className="gsi-material-button-content-wrapper" style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'center' }}>
      <div className="gsi-material-button-icon" style={{ marginRight: 12 }}>
        {/* Google SVG */}
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block', width: 24, height: 24 }}>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
          <path fill="none" d="M0 0h48v48H0z"></path>
        </svg>
      </div>
      <span className="gsi-material-button-contents" style={{ fontWeight: 500, fontSize: 16, color: '#3c4043' }}>
        {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
      </span>
      <span style={{ display: 'none' }}>
        {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
      </span>
      {loading && (
        <div className="ml-2 animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
      )}
    </div>
  </button>
);

const Auth = () => {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [isPasswordReset, setIsPasswordReset] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ currentModel: '', currentPrompt: '', completed: 0, total: 0 });
  const [showVerifyEmailMessage, setShowVerifyEmailMessage] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);

  // Get onboarding data and redirect destination from location state
  const onboardingData = location.state?.onboardingData;
  const redirectTo = location.state?.redirectTo || '/dashboard';

  // Redirect if already authenticated and email is confirmed
  useEffect(() => {
    if (
      user &&
      !authLoading &&
      (user.email_confirmed_at || user.confirmed_at)
    ) {
      // If the user arrived via a password reset link, send them to reset page
      if (sessionStorage.getItem('passwordRecovery') === 'true') {
        navigate('/reset-password');
        return;
      }

      // If admin, go straight to admin panel
      const adminEmails = ['karim@perceptionx.ai'];
      if (adminEmails.includes(user.email?.toLowerCase() || '')) {
        navigate('/admin');
        return;
      }

      // Onboarding flow retired — admin-provisioned users go straight to dashboard.
      navigate('/dashboard', { state: { onboardingData, userId: user.id } });
    }
  }, [user, authLoading, navigate, onboardingData, redirectTo]);

  const linkOnboardingToUser = async (_userId: string) => {
    // Onboarding flow retired — users are provisioned by admins. This used
    // to write to user_onboarding, which is no longer a runtime data
    // source. Kept as a no-op so call sites don't break.
    return;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate and sanitize email input
      const sanitizedEmail = sanitizeInput(formData.email.trim());
      if (!validateEmail(sanitizedEmail)) {
        toast.error('Please enter a valid email address');
        setLoading(false);
        return;
      }

      if (isPasswordReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(sanitizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) {
          logger.error('Password reset error:', error);
          if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
            toast.error('Email service is currently unavailable. Please try again later or contact support.');
          } else {
            throw error;
          }
          return;
        }
        
        toast.success('Password reset email sent! Please check your inbox.');
        setFormData({ email: '', password: '' });
        setIsPasswordReset(false);
        return;
      }

      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: sanitizedEmail,
          password: formData.password,
        });

        if (error) throw error;
        
        // Signed in successfully - no toast needed
        
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
        
        // If admin, go straight to admin
        const adminEmails = ['karim@perceptionx.ai'];
        if (adminEmails.includes((data.user.email || '').toLowerCase())) {
          navigate('/admin');
          return;
        }

        // Onboarding retired — admin-provisioned users land on dashboard.
        navigate('/dashboard');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: sanitizedEmail,
          password: formData.password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) throw error;

        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }

        // Account created - no toast needed
        setShowVerifyEmailMessage(true);
        return;
      }
    } catch (error: any) {
      logger.error('Auth error:', error);
      toast.error(error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      toast.success('Verification email resent! Please check your inbox.');
    } catch (error: any) {
      toast.error(error.message || 'Failed to resend verification email.');
    } finally {
      setResendLoading(false);
    }
  };

  // Add Google sign in/up handler
  const handleGoogleAuth = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || 'Google authentication failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  if (user || checkingOnboarding) {
    return <LoadingScreen />;
  }

  // Orbit icons — files in /public/logos/. Angles are hand-tuned so they scatter unevenly.
  const innerOrbit = [
    { src: '/logos/chatgpt.png', alt: 'ChatGPT', angle: 20 },
    { src: '/logos/Gemini.png', alt: 'Gemini', angle: 110 },
    { src: '/logos/perplexity.png', alt: 'Perplexity', angle: 200 },
    { src: '/logos/google.png', alt: 'Google', angle: 290 },
  ];
  const outerOrbit = [
    { src: '/logos/LinkedIn.png', alt: 'LinkedIn', angle: 55 },
    { src: '/logos/Glassdoor.svg', alt: 'Glassdoor', angle: 135 },
    { src: '/logos/Reddit.svg', alt: 'Reddit', angle: 215 },
    { src: '/logos/YouTube.png', alt: 'YouTube', angle: 320 },
  ];

  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center relative p-4 sm:p-6"
      style={{ background: '#f7dee7' }}
    >
      <div className="relative w-full max-w-6xl bg-white rounded-3xl border border-silver shadow-xl overflow-hidden flex flex-col lg:flex-row">
        {/* Left column — auth form */}
        <div className="w-full lg:w-1/2 flex flex-col p-6 sm:p-10 lg:p-12">
          <div className="lg:flex-1 flex items-center justify-center lg:py-8">
          <div className="w-full max-w-sm flex flex-col">
          <div className="mb-6">
            <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer" className="inline-block">
              <img src="/logos/PerceptionX-PrimaryLogo.png" alt="PerceptionX" className="h-8" />
            </a>
          </div>
          <div className="mb-8">
            <h1 className="text-3xl text-nightsky font-bold" style={{ fontFamily: 'Geologica, sans-serif' }}>
              {showVerifyEmailMessage
                ? 'Verify your email'
                : isPasswordReset
                  ? 'Reset Password'
                  : isLogin
                    ? 'Sign In'
                    : 'Get Started'}
            </h1>
            <p className="text-sm text-nightsky/60 mt-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              {showVerifyEmailMessage
                ? 'Check your inbox to verify your account.'
                : isPasswordReset
                  ? "We'll send you a reset link."
                  : 'Welcome back. Please log in to continue.'}
            </p>
          </div>
          <div>
            {showVerifyEmailMessage ? (
              <div className="text-center space-y-6">
                <p className="mb-6 text-nightsky text-base" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  We've sent a verification link to your email address. Please check your inbox and spam folder, then click the link to activate your account.
                </p>
                <Button className="w-full bg-nightsky text-white rounded-full font-bold text-base" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }} onClick={() => {
                  setShowVerifyEmailMessage(false);
                  setIsLogin(true);
                  setFormData({ email: '', password: '' });
                }}>
                  Back to Login
                </Button>
                <Button
                  className="w-full mt-2 border-nightsky text-nightsky rounded-full font-bold text-base"
                  variant="outline"
                  type="button"
                  disabled={resendLoading}
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  onClick={handleResendVerification}
                >
                  {resendLoading ? 'Resending...' : 'Resend verification email'}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Google and Microsoft Login Buttons and Divider only for login/signup, not password reset */}
                {/* Hidden per user request */}
                {false && !isPasswordReset && (
                  <>
                    <GoogleMaterialButton
                      onClick={handleGoogleAuth}
                      loading={googleLoading}
                      mode={isLogin ? 'login' : 'signup'}
                    />
                    {/* Divider */}
                    <div className="flex items-center my-4">
                      <div className="flex-grow h-px bg-silver" />
                      <span className="mx-2 text-silver text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>or</span>
                      <div className="flex-grow h-px bg-silver" />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="border-silver focus:border-nightsky focus:ring-nightsky text-base placeholder:text-nightsky/40 placeholder:font-normal"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  />
                </div>
                {!isPasswordReset && (
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={formData.password}
                        onChange={handleInputChange}
                        required
                        className="border-silver focus:border-nightsky focus:ring-nightsky text-base pr-10 placeholder:text-nightsky/40 placeholder:font-normal"
                        style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-nightsky/50 hover:text-nightsky transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}
                {/* Remember Me and Forgot Password */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center text-sm text-nightsky" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                    <input type="checkbox" checked readOnly className="form-checkbox mr-2 accent-nightsky" />
                    Remember Me
                  </label>
                  {!isPasswordReset && (
                    <button
                      type="button"
                      onClick={() => setIsPasswordReset(true)}
                      className="text-sm text-pink-500 hover:underline font-bold"
                      style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full bg-nightsky hover:bg-dusk-navy text-white rounded-full font-bold text-base"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  disabled={loading}
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : isPasswordReset ? (
                    'Send Reset Link'
                  ) : isLogin ? (
                    'Log in'
                  ) : (
                    'Create Account'
                  )}
                </Button>
                <div className="text-center mt-2">
                  {isPasswordReset ? (
                    <button
                      type="button"
                      onClick={() => setIsPasswordReset(false)}
                      className="text-sm text-nightsky hover:underline font-bold"
                      style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                    >
                      Back to {isLogin ? 'sign in' : 'sign up'}
                    </button>
                  ) : (
                    // Hidden per user request
                    false && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsLogin(!isLogin);
                          setIsPasswordReset(false);
                        }}
                        className="text-sm text-pink-500 hover:underline font-bold"
                        style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                      >
                        {isLogin ? "Not member yet? Create an account" : 'Already have an account? Sign in'}
                      </button>
                    )
                  )}
                </div>
              </form>
            )}
          </div>
          </div>
          </div>

          {/* Footer links */}
          <div className="mt-8 text-center space-x-6">
            <a
              href="https://perceptionx.ai/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-nightsky hover:text-pink-500 transition-colors"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Privacy Policy
            </a>
            <a
              href="https://perceptionx.ai/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-nightsky hover:text-pink-500 transition-colors"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
            >
              Terms & Conditions
            </a>
          </div>

          {/* Book a demo */}
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-nightsky font-medium whitespace-nowrap" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <span>Looking to learn more?</span>
            <a
              href="https://meetings-eu1.hubspot.com/karim-al-ansari"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-pink text-white px-4 py-1.5 rounded-full hover:bg-pink/90 transition-colors font-bold text-xs"
            >
              Book a demo
            </a>
          </div>
        </div>

        {/* Right column — orbit panel */}
        <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-blue-50 via-white to-pink-50 p-8 flex-col items-center justify-center gap-6">
          <h2
            className="text-2xl font-bold text-center text-nightsky leading-tight max-w-lg"
            style={{ fontFamily: 'Geologica, sans-serif' }}
          >
            AI Employer Brand Intelligence for
            <br />
            <span className="text-pink">Enterprise Talent Teams</span>
          </h2>

          {/* Orbit */}
          <div className="relative w-[360px] h-[360px] flex items-center justify-center">
            {/* Concentric rings */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 360 360"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="180" cy="180" r="70" stroke="#dbe2f0" strokeWidth="1" />
              <circle cx="180" cy="180" r="120" stroke="#dbe2f0" strokeWidth="1" />
              <circle cx="180" cy="180" r="170" stroke="#dbe2f0" strokeWidth="1" />
            </svg>

            {/* Center logo badge */}
            <div className="relative z-10 w-14 h-14 rounded-full shadow-lg overflow-hidden">
              <img
                src="/logos/PinkBadge.png"
                alt="PerceptionX"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Inner ring — AI models */}
            {innerOrbit.map((icon) => (
              <div
                key={icon.alt}
                className="absolute top-1/2 left-1/2 w-12 h-12 -ml-6 -mt-6 rounded-full bg-white shadow-md flex items-center justify-center"
                style={{
                  transform: `rotate(${icon.angle}deg) translateY(-120px) rotate(-${icon.angle}deg)`,
                }}
              >
                <img src={icon.src} alt={icon.alt} className="w-7 h-7 object-contain" />
              </div>
            ))}

            {/* Outer ring — review/talent sites */}
            {outerOrbit.map((icon) => (
              <div
                key={icon.alt}
                className="absolute top-1/2 left-1/2 w-12 h-12 -ml-6 -mt-6 rounded-full bg-white shadow-md flex items-center justify-center"
                style={{
                  transform: `rotate(${icon.angle}deg) translateY(-170px) rotate(-${icon.angle}deg)`,
                }}
              >
                <img src={icon.src} alt={icon.alt} className="w-7 h-7 object-contain" />
              </div>
            ))}
          </div>

          <p
            className="text-center text-sm text-nightsky/70 max-w-md leading-relaxed"
            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
          >
            Give every team — across every market — one source of truth for shaping AI answers about your employer brand.
          </p>
        </div>
      </div>
      {showLoadingModal && (
        <LoadingModal
          isOpen={showLoadingModal}
          onClose={() => setShowLoadingModal(false)}
          progress={loadingProgress}
        />
      )}
    </div>
  );
};

export default Auth;
