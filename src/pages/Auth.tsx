
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [isLogin, setIsLogin] = useState(false); // Changed default to false (create account)
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    companyName: ''
  });

  // Get onboarding data and redirect destination from location state
  const onboardingData = location.state?.onboardingData;
  const redirectTo = location.state?.redirectTo || '/dashboard';

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      if (onboardingData && redirectTo === '/prompts') {
        navigate('/prompts', { 
          state: { 
            onboardingData,
            userId: user.id 
          } 
        });
      } else {
        navigate('/dashboard');
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
        
        // Redirect with onboarding data if available
        if (onboardingData && redirectTo === '/prompts') {
          navigate('/prompts', { 
            state: { 
              onboardingData,
              userId: data.user?.id 
            } 
          });
        } else {
          navigate('/dashboard');
        }
      } else {
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
        
        // If we have onboarding data, go to prompts, otherwise go to onboarding
        if (onboardingData) {
          navigate('/prompts', { 
            state: { 
              onboardingData,
              userId: data.user?.id 
            } 
          });
        } else {
          navigate('/onboarding');
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
      <div className="w-full max-w-md mx-6">
        <div className="absolute top-4 left-4">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="flex items-center"
          >
            <X className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>

        <Card className="bg-white shadow-xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl">
              {isLogin ? 'Sign In' : 'Create Account'}
            </CardTitle>
            <p className="text-gray-600 text-sm">
              {onboardingData ? 
                'Create an account to save your personalized prompts and start monitoring' :
                (isLogin ? 'Welcome back!' : 'Start monitoring your AI perception')
              }
            </p>
          </CardHeader>
          
          <CardContent>
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

              {!isLogin && (
                <div>
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    type="text"
                    value={formData.companyName || onboardingData?.companyName || ''}
                    onChange={handleInputChange}
                    required
                    placeholder="Enter your company name"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90"
                disabled={loading}
              >
                {loading ? 'Loading...' : (isLogin ? 'Sign In' : 'Create Account')}
              </Button>
            </form>

            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-primary hover:text-primary/80 underline text-sm"
              >
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>

            {onboardingData && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                <strong>Your analysis is ready!</strong> Create an account to view your personalized prompts for {onboardingData.companyName}.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
