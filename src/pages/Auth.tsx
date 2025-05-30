import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, ArrowRight, Sparkles, BarChart3, Target, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingModal } from '@/components/prompts/LoadingModal';
import { generateAndInsertPrompts, ProgressInfo } from '@/hooks/usePromptsLogic';

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    companyName: ''
  });
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ currentModel: '', currentPrompt: '', completed: 0, total: 0 });

  // Get onboarding data and redirect destination from location state
  const onboardingData = location.state?.onboardingData;
  const redirectTo = location.state?.redirectTo || '/dashboard';

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      if (!onboardingData) {
        navigate('/onboarding');
      } else {
        navigate('/prompts', { 
          state: { 
            onboardingData,
            userId: user.id 
          } 
        });
      }
    }
  }, [user, navigate, onboardingData, redirectTo]);

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
          hiring_challenges: onboardingData.hiringChallenges,
          target_roles: onboardingData.targetRoles,
          current_strategy: onboardingData.currentStrategy,
          talent_competitors: onboardingData.talentCompetitors,
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
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });

        if (error) throw error;
        
        console.log('User signed in:', data.user?.id);
        toast.success('Signed in successfully!');
        
        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }
        
        navigate('/dashboard');
      } else {
        // Create the account directly
        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
        });

        if (error) throw error;

        console.log('User signed up:', data.user?.id);

        // Update profile with company name
        if (formData.companyName) {
          const { error: profileError } = await supabase
            .from('profiles')
            .update({ company_name: formData.companyName })
            .eq('email', formData.email);

          if (profileError) {
            console.error('Error updating profile:', profileError);
          }
        }

        // Link onboarding data if available
        if (onboardingData && data.user) {
          await linkOnboardingToUser(data.user.id);
        }

        toast.success('Account created successfully!');
        
        // Show loading modal and generate prompts
        setShowLoadingModal(true);
        setLoadingProgress({ currentModel: '', currentPrompt: '', completed: 0, total: 0 });
        
        try {
          // Fetch the onboarding record for the user
          const { data: onboardingRecord, error: onboardingError } = await supabase
            .from('user_onboarding')
            .select('*')
            .eq('user_id', data.user.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (onboardingError) {
            throw onboardingError;
          }

          if (onboardingRecord && onboardingRecord.length > 0) {
            // Generate and insert prompts
            await generateAndInsertPrompts(
              data.user,
              onboardingRecord[0],
              onboardingData,
              (progress: ProgressInfo) => {
                setLoadingProgress({
                  currentModel: progress.currentModel || '',
                  currentPrompt: progress.currentPrompt || '',
                  completed: progress.completed ?? 0,
                  total: progress.total ?? 0
                });
              }
            );
          }
        } catch (error) {
          console.error('Error generating prompts:', error);
          toast.error('Failed to generate prompts. Please try again.');
        } finally {
          setShowLoadingModal(false);
          navigate('/dashboard');
        }
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
    <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(to bottom right, #045962, #019dad)'}}>
      <div className="w-full max-w-5xl mx-6">
        <div className="absolute top-4 left-4">
          <Button
            variant="ghost"
            onClick={() => window.location.href = 'https://www.perceptionx.co'}
            className="flex items-center text-white hover:text-white/80"
          >
            <X className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-center">
          {/* Left side - Value Proposition */}
          <div className="text-white space-y-6">
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                Understand Your Employer Brand's
                <span className="block text-blue-200">AI Perception</span>
              </h1>
              <p className="text-lg text-blue-100">
                Get data-driven insights into how AI models perceive your company's employer brand and talent acquisition strategy.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <Sparkles className="w-6 h-6 text-blue-200 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold">AI-Powered Insights</h3>
                  <p className="text-blue-100">Track how leading AI models like ChatGPT, Claude, and Gemini perceive your company</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <BarChart3 className="w-6 h-6 text-blue-200 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold">Data-Driven Strategy</h3>
                  <p className="text-blue-100">Make informed decisions to improve your talent acquisition and employer branding</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Target className="w-6 h-6 text-blue-200 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold">Competitive Analysis</h3>
                  <p className="text-blue-100">Compare your employer brand perception against industry competitors</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Auth Card */}
          <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
            <CardHeader className="text-center pb-4">
              {/* Removed 'Welcome to PerceptionX' title and subtitle */}
            </CardHeader>
            
            <CardContent className="space-y-6">
              {!showAuthForm ? (
                <>
                  {/* Primary CTA */}
                  <Button
                    onClick={() => {
                      setIsLogin(false);
                      setShowAuthForm(true);
                    }}
                    className="w-full bg-primary hover:bg-primary/90 h-14 text-lg group"
                  >
                    Create Free Account
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-200"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-white text-gray-500">or</span>
                    </div>
                  </div>

                  {/* Secondary CTA */}
                  <Button
                    onClick={() => {
                      setIsLogin(true);
                      setShowAuthForm(true);
                    }}
                    variant="outline"
                    className="w-full h-14 text-lg"
                  >
                    Sign In to Your Account
                  </Button>

                  {onboardingData && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                      <strong>Your analysis is ready!</strong> Create an account to view your personalized prompts for {onboardingData.companyName}.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-center mb-4">
                    <h3 className="text-lg font-semibold">
                      {isLogin ? 'Welcome Back!' : 'Create Your Free Account'}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {isLogin 
                        ? 'Sign in to access your dashboard and prompts'
                        : 'Create an account to start your free analysis'
                      }
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
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
                      />
                    </div>

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
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-primary hover:bg-primary/90"
                      disabled={loading}
                    >
                      {loading ? 'Loading...' : (isLogin ? 'Sign In' : 'Continue to Analysis')}
                    </Button>
                  </form>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setIsLogin(!isLogin);
                        setFormData({ email: '', password: '', companyName: '' });
                      }}
                      className="text-primary hover:text-primary/80 underline text-sm"
                    >
                      {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                    </button>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => setShowAuthForm(false)}
                    className="w-full"
                  >
                    Back to Options
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
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
