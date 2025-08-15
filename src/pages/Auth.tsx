import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, ArrowRight, Sparkles, BarChart3, Target, Users, Mail, Medal } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingModal } from '@/components/prompts/LoadingModal';
import { generateAndInsertPrompts, ProgressInfo } from '@/hooks/usePromptsLogic';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { validateEmail, sanitizeInput, logger } from '@/lib/utils';

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
      // If admin, go straight to admin panel
      const adminEmails = ['karim@perceptionx.ai'];
      if (adminEmails.includes(user.email?.toLowerCase() || '')) {
        navigate('/admin');
        return;
      }

      // Check if user needs onboarding before redirecting
      setCheckingOnboarding(true);
      const checkOnboardingAndRedirect = async () => {
        try {
          const { data: userOnboardingData, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('id, company_name, industry')
            .eq('user_id', user.id)
            .not('company_name', 'is', null)
            .not('industry', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);

          if (onboardingError) {
            console.error('Error checking onboarding status:', onboardingError);
            // If we can't check, default to dashboard
            navigate('/dashboard', { 
              state: { 
                onboardingData,
                userId: user.id 
              } 
            });
            return;
          }

          // If no basic onboarding data, redirect to onboarding
          if (!userOnboardingData || userOnboardingData.length === 0 || 
              !userOnboardingData[0].company_name || !userOnboardingData[0].industry) {
            navigate('/onboarding');
            return;
          }

          // Check if there are actual confirmed prompts
          const { data: promptsData, error: promptsError } = await supabase
            .from('confirmed_prompts')
            .select('id')
            .eq('onboarding_id', userOnboardingData[0].id)
            .limit(1);

          if (promptsError) {
            console.error('Error checking confirmed prompts:', promptsError);
            // If we can't check, default to dashboard
            navigate('/dashboard', { 
              state: { 
                onboardingData,
                userId: user.id 
              } 
            });
            return;
          }

          // If no confirmed prompts, onboarding is incomplete
          if (!promptsData || promptsData.length === 0) {
            navigate('/onboarding');
          } else {
            // User has completed onboarding, go to dashboard
            navigate('/dashboard', { 
              state: { 
                onboardingData,
                userId: user.id 
              } 
            });
          }
        } catch (onboardingCheckError) {
          console.error('Error checking onboarding status:', onboardingCheckError);
          // If we can't check, default to dashboard
          navigate('/dashboard', { 
            state: { 
              onboardingData,
              userId: user.id 
            } 
          });
        } finally {
          setCheckingOnboarding(false);
        }
      };

      checkOnboardingAndRedirect();
    }
  }, [user, authLoading, navigate, onboardingData, redirectTo]);

  const linkOnboardingToUser = async (userId: string) => {
    if (!onboardingData) return;

    try {
      // First, check if user already has an onboarding record
      const { data: existingRecord } = await supabase
        .from('user_onboarding')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (existingRecord && existingRecord.length > 0) {
        return;
      }

      // Look for unlinked onboarding records that match the company name
      const { data: unlinkedRecords } = await supabase
        .from('user_onboarding')
        .select('*')
        .is('user_id', null)
        .eq('company_name', onboardingData.companyName)
        .order('created_at', { ascending: false })
        .limit(1);

      if (unlinkedRecords && unlinkedRecords.length > 0) {
        // Link existing record to user
        const { error: linkError } = await supabase
          .from('user_onboarding')
          .update({ user_id: userId })
          .eq('id', unlinkedRecords[0].id);

        if (linkError) {
          console.error('Error linking onboarding record:', linkError);
        }
      } else {
        // Create new onboarding record for the user
        const newRecord = {
          user_id: userId,
          company_name: onboardingData.companyName,
          industry: onboardingData.industry,
          session_id: `session_${userId}_${Date.now()}`
        };

        const { error: createError } = await supabase
          .from('user_onboarding')
          .insert(newRecord);

        if (createError) {
          console.error('Error creating onboarding record:', createError);
        }
      }
    } catch (error) {
      console.error('Error in linkOnboardingToUser:', error);
    }
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
          console.error('Password reset error:', error);
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

        // Check if user needs onboarding before redirecting
        setCheckingOnboarding(true);
        const checkOnboardingAndRedirect = async () => {
          try {
            const { data: userOnboardingData, error: onboardingError } = await supabase
              .from('user_onboarding')
              .select('id, company_name, industry')
              .eq('user_id', data.user.id)
              .not('company_name', 'is', null)
              .not('industry', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1);

            if (onboardingError) {
              console.error('Error checking onboarding status:', onboardingError);
              // If we can't check, default to dashboard
              navigate('/dashboard');
              return;
            }

            // If no basic onboarding data, redirect to onboarding
            if (!userOnboardingData || userOnboardingData.length === 0 || 
                !userOnboardingData[0].company_name || !userOnboardingData[0].industry) {
              navigate('/onboarding');
              return;
            }

            // Check if there are actual confirmed prompts
            const { data: promptsData, error: promptsError } = await supabase
              .from('confirmed_prompts')
              .select('id')
              .eq('onboarding_id', userOnboardingData[0].id)
              .limit(1);

            if (promptsError) {
              console.error('Error checking confirmed prompts:', promptsError);
              // If we can't check, default to dashboard
              navigate('/dashboard');
              return;
            }

            // If no confirmed prompts, onboarding is incomplete
            if (!promptsData || promptsData.length === 0) {
              navigate('/onboarding');
            } else {
              // User has completed onboarding, go to dashboard
              navigate('/dashboard');
            }
                  } catch (onboardingCheckError) {
          console.error('Error checking onboarding status:', onboardingCheckError);
          // If we can't check, default to dashboard
          navigate('/dashboard');
        } finally {
          setCheckingOnboarding(false);
        }
      };

        checkOnboardingAndRedirect();
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

  return (
    <div className="min-h-screen w-screen flex items-center justify-center relative" style={{ background: '#f7dee7' }}>
      {/* Top left logo */}
      <div className="absolute top-6 left-6 z-10">
        <a href="https://perceptionx.ai" target="_blank" rel="noopener noreferrer">
          <img src="/logos/PinkBadge.png" alt="PerceptionX" className="h-8 rounded-md shadow-md" />
        </a>
      </div>
      
      {/* Top right demo link */}
      <div className="absolute top-6 z-10 right-6 md:right-6 left-1/2 md:left-auto transform md:transform-none -translate-x-1/2 md:translate-x-0">
        <div className="flex items-center gap-2 text-sm text-nightsky font-medium text-center whitespace-nowrap" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          <span>Looking to learn more?</span>
          <a 
            href="https://meetings-eu1.hubspot.com/karim-al-ansari" 
            target="_blank" 
            rel="noopener noreferrer"
            className="border-2 border-pink text-pink bg-transparent px-3 py-1 rounded-full hover:bg-pink hover:text-white transition-colors font-bold text-xs"
          >
            Book a demo
          </a>
        </div>
      </div>
      <div className="w-full max-w-md flex items-center justify-center p-8 relative flex-col">
        <Card className="w-full bg-white rounded-2xl border border-silver">
          <CardHeader>
            <div className="flex items-center justify-center gap-3">
              <CardTitle className="text-2xl text-center text-nightsky font-bold" style={{ fontFamily: 'Geologica, sans-serif' }}>
                {showVerifyEmailMessage
                  ? 'Verify your email'
                  : isPasswordReset
                    ? 'Reset Password'
                    : isLogin
                      ? 'Sign In'
                      : 'Get Started'}
              </CardTitle>
              <Badge className="bg-pink text-white px-2 py-0.5 text-xs font-bold">
                BETA
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {showVerifyEmailMessage ? (
              <div className="text-center space-y-6">
                <p className="mb-6 text-nightsky text-base" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                  We've sent a verification link to your email address. Please check your inbox and click the link to activate your account.
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
                {!isPasswordReset && (
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
                    className="border-silver focus:border-nightsky focus:ring-nightsky text-base"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  />
                </div>
                {!isPasswordReset && (
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-nightsky font-medium" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Password</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={handleInputChange}
                      required
                      className="border-silver focus:border-nightsky focus:ring-nightsky text-base"
                      style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                    />
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
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
        
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
