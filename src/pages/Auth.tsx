import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, ArrowRight, Sparkles, BarChart3, Target, Users, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingModal } from '@/components/prompts/LoadingModal';
import { generateAndInsertPrompts, ProgressInfo } from '@/hooks/usePromptsLogic';

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
      navigate('/dashboard', { 
        state: { 
          onboardingData,
          userId: user.id 
        } 
      });
    }
  }, [user, authLoading, navigate, onboardingData, redirectTo]);

  const linkOnboardingToUser = async (userId: string) => {
    if (!onboardingData) return;

    try {
      console.log('Linking onboarding data to user:', userId);
      
      // First, check if user already has an onboarding record
      const { data: existingRecord } = await supabase
        .from('user_onboarding')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (existingRecord && existingRecord.length > 0) {
        console.log('User already has onboarding record');
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
        } else {
          console.log('Successfully linked existing onboarding record');
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
        } else {
          console.log('Successfully created new onboarding record');
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
      if (isPasswordReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) throw error;
        
        toast.success('Password reset email sent! Please check your inbox.');
        setFormData({ email: '', password: '' });
        setIsPasswordReset(false);
        return;
      }

      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });

        if (error) throw error;
        
        console.log('User signed in:', data.user?.id);
        toast.success('Signed in successfully!');
        
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
        
        navigate('/dashboard');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) throw error;

        console.log('User signed up:', data.user?.id);

        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }

        toast.success('Account created! Please check your email to confirm your account.');
        setShowVerifyEmailMessage(true);
        return;
      }
    } catch (error: any) {
      console.error('Auth error:', error);
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

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-100">
      {/* Left side - Illustration and Marketing Copy with geometric background */}
      <div className="flex-1 flex flex-col justify-center items-center px-8 py-12 relative overflow-hidden" style={{ background: 'linear-gradient(to right bottom, #045962, #019dad)' }}>
        {/* Enhanced Geometric SVG background */}
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-0" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg" style={{opacity:0.45}}>
          {/* Large blurred circle */}
          <circle cx="18%" cy="12%" r="110" fill="#fff" fillOpacity="0.18" filter="url(#blur1)" />
          {/* Medium circle */}
          <circle cx="80%" cy="30%" r="60" fill="#fff" fillOpacity="0.13" />
          {/* Small circles */}
          <circle cx="90%" cy="90%" r="28" fill="#fff" fillOpacity="0.15" />
          <circle cx="30%" cy="80%" r="18" fill="#fff" fillOpacity="0.13" />
          <circle cx="60%" cy="60%" r="14" fill="#fff" fillOpacity="0.13" />
          {/* Squares */}
          <rect x="70%" y="70%" width="90" height="90" rx="18" fill="#fff" fillOpacity="0.10" />
          <rect x="10%" y="60%" width="60" height="60" rx="12" fill="#fff" fillOpacity="0.09" />
          {/* Grid lines */}
          <g stroke="#fff" strokeOpacity="0.10" strokeWidth="1">
            <line x1="10%" y1="10%" x2="90%" y2="10%" />
            <line x1="10%" y1="30%" x2="90%" y2="30%" />
            <line x1="10%" y1="50%" x2="90%" y2="50%" />
            <line x1="10%" y1="70%" x2="90%" y2="70%" />
            <line x1="10%" y1="90%" x2="90%" y2="90%" />
            <line x1="20%" y1="0%" x2="20%" y2="100%" />
            <line x1="40%" y1="0%" x2="40%" y2="100%" />
            <line x1="60%" y1="0%" x2="60%" y2="100%" />
            <line x1="80%" y1="0%" x2="80%" y2="100%" />
          </g>
          {/* Chart-like line */}
          <polyline points="10,300 80,220 180,260 300,180 400,220 500,120 600,200 700,100 800,180 900,80" fill="none" stroke="#fff" strokeWidth="2.5" strokeOpacity="0.18" />
          {/* Dots */}
          <circle cx="25%" cy="40%" r="4" fill="#fff" fillOpacity="0.22" />
          <circle cx="55%" cy="20%" r="3" fill="#fff" fillOpacity="0.22" />
          <circle cx="75%" cy="75%" r="5" fill="#fff" fillOpacity="0.22" />
          <defs>
            <filter id="blur1" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="30" />
            </filter>
          </defs>
        </svg>
        {/* Content above background */}
        <div className="relative z-10 w-full flex flex-col items-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 text-left w-full max-w-3xl pl-8 md:pl-16 pr-8 md:pr-16">Take control of your talent perception</h1>
          <p className="text-lg text-white text-left w-full max-w-2xl mb-6 pl-8 md:pl-16 pr-8 md:pr-16">Track how leading AI models like ChatGPT, Claude, and Gemini perceive your company.</p>
          <div className="space-y-6 mt-8 max-w-md w-full">
            <div className="flex items-start space-x-3">
              <Sparkles className="w-6 h-6 text-pink-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-white">AI-Powered Insights</h3>
                <p className="text-white text-sm">Monitor how leading AI models perceive your company and help shape the narrative</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <BarChart3 className="w-6 h-6 text-pink-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-white">Data-Driven Strategy</h3>
                <p className="text-white text-sm">Make informed decisions to improve your talent acquisition and employer branding</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <Target className="w-6 h-6 text-pink-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-white">Competitive Analysis</h3>
                <p className="text-white text-sm">Compare your employer brand perception against industry competitors</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Right side - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white relative flex-col">
        <img src="/logos/perceptionx-normal.png" alt="PerceptionX Logo" className="mx-auto mb-10 h-7" />
        <Card className="w-full max-w-md bg-white rounded-2xl border border-gray-100">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-gray-900">
              {showVerifyEmailMessage
                ? 'Verify your email'
                : isPasswordReset
                  ? 'Reset Password'
                  : isLogin
                    ? 'Sign In'
                    : 'Get Started'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showVerifyEmailMessage ? (
              <div className="text-center space-y-6">
                <p className="mb-6">
                  We've sent a verification link to your email address. Please check your inbox and click the link to activate your account.
                </p>
                <Button className="w-full" onClick={() => {
                  setShowVerifyEmailMessage(false);
                  setIsLogin(true);
                  setFormData({ email: '', password: '' });
                }}>
                  Back to Login
                </Button>
                <Button
                  className="w-full mt-2"
                  variant="outline"
                  type="button"
                  disabled={resendLoading}
                  onClick={handleResendVerification}
                >
                  {resendLoading ? 'Resending...' : 'Resend verification email'}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Google Login Button and Divider only for login/signup, not password reset */}
                {!isPasswordReset && (
                  <>
                    <GoogleMaterialButton
                      onClick={handleGoogleAuth}
                      loading={googleLoading}
                      mode={isLogin ? 'login' : 'signup'}
                    />
                    {/* Divider */}
                    <div className="flex items-center my-4">
                      <div className="flex-grow h-px bg-gray-200" />
                      <span className="mx-2 text-gray-400 text-sm">or</span>
                      <div className="flex-grow h-px bg-gray-200" />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                {!isPasswordReset && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                )}
                {/* Remember Me and Forgot Password */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center text-sm text-gray-600">
                    <input type="checkbox" checked readOnly className="form-checkbox mr-2 accent-[#045962]" />
                    Remember Me
                  </label>
                  {!isPasswordReset && (
                    <button
                      type="button"
                      onClick={() => setIsPasswordReset(true)}
                      className="text-sm text-[#045962] hover:underline"
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full bg-[#045962] hover:bg-[#03474d] text-white rounded-full"
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
                      className="text-sm text-[#045962] hover:underline"
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
                      className="text-sm text-[#045962] hover:underline"
                    >
                      {isLogin ? "Not member yet? Create an account" : 'Already have an account? Sign in'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
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
