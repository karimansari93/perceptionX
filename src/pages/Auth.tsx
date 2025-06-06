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

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ currentModel: '', currentPrompt: '', completed: 0, total: 0 });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');

  // Get onboarding data and redirect destination from location state
  const onboardingData = location.state?.onboardingData;
  const redirectTo = location.state?.redirectTo || '/dashboard';

  // Check for email verification in URL
  useEffect(() => {
    const handleEmailVerification = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Error checking session:', error);
        return;
      }

      if (session?.user?.email_confirmed_at) {
        toast.success('Email verified successfully!');
        navigate('/dashboard');
      }
    };

    handleEmailVerification();
  }, [navigate]);

  // Redirect if already authenticated
  useEffect(() => {
    if (user && !authLoading) {
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

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      toast.success('Password reset instructions sent to your email');
      setShowResetPassword(false);
    } catch (error: any) {
      console.error('Password reset error:', error);
      toast.error(error.message || 'Failed to send password reset email');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });

        if (error) {
          if (error.message.includes('Email not confirmed')) {
            toast.error('Please verify your email before signing in');
            setVerificationEmail(formData.email);
            setVerificationSent(true);
            return;
          }
          throw error;
        }
        
        console.log('User signed in:', data.user?.id);
        toast.success('Signed in successfully!');
        
        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
        
        navigate('/dashboard');
      } else {
        // Create the account with email verification
        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
          },
        });

        if (error) throw error;

        if (data.user) {
          setVerificationEmail(formData.email);
          setVerificationSent(true);
          toast.success('Please check your email to verify your account');
        }

        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      toast.error(error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: verificationEmail,
      });

      if (error) throw error;

      toast.success('Verification email resent successfully');
    } catch (error: any) {
      console.error('Error resending verification:', error);
      toast.error(error.message || 'Failed to resend verification email');
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
    <div className="min-h-screen flex flex-col md:flex-row" style={{ background: 'linear-gradient(to right bottom, rgb(4, 89, 98), rgb(1, 157, 173))' }}>
      {/* Left side - Illustration and Marketing Copy */}
      <div className="hidden md:flex flex-1 flex-col justify-center items-center px-8 py-12 relative">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 text-center">Take control of your talent perception</h1>
        <p className="text-lg text-white mb-8 text-center max-w-lg">Track how leading AI models like ChatGPT, Claude, and Gemini perceive your company. Make informed decisions to improve your talent acquisition and employer branding.</p>
        <div className="space-y-6 mt-8 max-w-md w-full">
          <div className="flex items-start space-x-3">
            <Sparkles className="w-6 h-6 text-pink-600 flex-shrink-0 mt-1" />
            <div>
              <h3 className="font-semibold text-white">AI-Powered Insights</h3>
              <p className="text-white text-sm">Track how leading AI models like ChatGPT, Claude, and Gemini perceive your company</p>
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
      {/* Right side - Auth Card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12 bg-transparent">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
          <div className="mb-8 text-center">
            {showResetPassword ? (
              <>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">Reset Password</h3>
                <p className="text-gray-500 text-sm">Enter your email to receive reset instructions</p>
              </>
            ) : verificationSent ? (
              <>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">Check Your Email</h3>
                <p className="text-gray-500 text-sm">We've sent you a verification link</p>
              </>
            ) : isLogin ? (
              <>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">Sign in to your account</h3>
                <p className="text-gray-500 text-sm">Access your dashboard and AI perception insights</p>
              </>
            ) : (
              <>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">Get started</h3>
                <p className="text-gray-500 text-sm">Use PerceptionX to track how leading AI models perceive your company</p>
              </>
            )}
          </div>

          {verificationSent ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Mail className="h-12 w-12 text-primary" />
              </div>
              <p className="text-gray-600">
                We've sent a verification link to {verificationEmail}. Please check your email and click the link to verify your account.
              </p>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? 'Sending...' : 'Resend Verification Email'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setVerificationSent(false);
                    setIsLogin(true);
                  }}
                  className="w-full"
                >
                  Back to Sign In
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={showResetPassword ? handlePasswordReset : handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter your email"
                  className="rounded-lg border-gray-200"
                />
              </div>
              {!showResetPassword && (
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    required
                    placeholder="Enter your password"
                    minLength={6}
                    className="rounded-lg border-gray-200"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90"
                disabled={loading}
              >
                {loading ? 'Loading...' : (
                  showResetPassword ? 'Send Reset Instructions' : 
                  (isLogin ? 'Sign In' : 'Create Account')
                )}
              </Button>

              <div className="text-center space-y-2">
                {showResetPassword ? (
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(false)}
                    className="text-primary hover:text-primary/80 text-sm block w-full"
                  >
                    Back to {isLogin ? 'Sign In' : 'Sign Up'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setShowResetPassword(false);
                    }}
                    className="text-primary hover:text-primary/80 text-sm block w-full"
                  >
                    {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                  </button>
                )}
                {!showResetPassword && (
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(true)}
                    className="text-gray-500 hover:text-gray-700 text-sm block w-full mt-1"
                  >
                    Forgot your password?
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
      {showLoadingModal && (
        <LoadingModal
          isOpen={showLoadingModal}
          currentModel={loadingProgress.currentModel}
          currentPrompt={loadingProgress.currentPrompt}
          completed={loadingProgress.completed}
          total={loadingProgress.total}
        />
      )}
    </div>
  );
};

export default Auth;
